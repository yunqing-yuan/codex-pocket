package studio.codexpocket.mobile;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import android.util.AtomicFile;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.nio.charset.StandardCharsets;
import java.io.File;
import java.io.FileOutputStream;
import java.util.Arrays;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import org.json.JSONObject;

/** Stores only authenticated ciphertext on disk; the key never leaves Android Keystore. */
@CapacitorPlugin(name = "PocketCredentials")
public class PocketCredentialsPlugin extends Plugin {
    private static final String ALIAS = "studio.codexpocket.mobile.pairing.v1";
    private static final String STORE = "pocket_credentials";
    private static final byte[] AAD = ALIAS.getBytes(StandardCharsets.UTF_8);
    private static final byte[] HISTORY_AAD = (ALIAS + ".history").getBytes(StandardCharsets.UTF_8);

    private AtomicFile historyFile() {
        return new AtomicFile(new File(getContext().getFilesDir(), "pocket-history.enc"));
    }

    @PluginMethod
    public synchronized void saveHistory(PluginCall call) {
        FileOutputStream output = null;
        AtomicFile file = historyFile();
        try {
            String value = call.getString("value");
            if (value == null) throw new IllegalArgumentException("Missing history");
            byte[] plain = value.getBytes(StandardCharsets.UTF_8);
            if (plain.length > 64 * 1024 * 1024) throw new IllegalArgumentException("History exceeds 64 MiB");
            new JSONObject(value);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, encryptionKey());
            cipher.updateAAD(HISTORY_AAD);
            byte[] encrypted = cipher.doFinal(plain);
            output = file.startWrite();
            output.write(cipher.getIV());
            output.write(encrypted);
            file.finishWrite(output);
            call.resolve();
        } catch (Exception error) {
            if (output != null) file.failWrite(output);
            call.reject("无法保存离线记录，请检查手机可用空间（本地记录上限 64 MiB）", "HISTORY_SAVE_FAILED");
        }
    }

    @PluginMethod
    public synchronized void loadHistory(PluginCall call) {
        try {
            JSObject result = new JSObject();
            AtomicFile file = historyFile();
            // openRead recovers an interrupted AtomicFile replacement.
            if (!file.getBaseFile().exists() && !new File(file.getBaseFile() + ".bak").exists()) {
                result.put("value", JSONObject.NULL);
            } else {
                byte[] bytes = file.readFully();
                if (bytes.length < 28) throw new IllegalStateException("Incomplete history");
                SecretKey key = (SecretKey) keyStore().getKey(ALIAS, null);
                if (key == null) throw new IllegalStateException("History key unavailable");
                Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
                cipher.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(128, Arrays.copyOfRange(bytes, 0, 12)));
                cipher.updateAAD(HISTORY_AAD);
                result.put("value", new String(cipher.doFinal(bytes, 12, bytes.length - 12), StandardCharsets.UTF_8));
            }
            call.resolve(result);
        } catch (Exception error) {
            call.reject("离线记录暂时无法读取，原文件已保留；联网后可重新同步", "HISTORY_LOAD_FAILED");
        }
    }

    private SharedPreferences preferences() {
        return getContext().getSharedPreferences(STORE, Context.MODE_PRIVATE);
    }

    private KeyStore keyStore() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        return store;
    }

    private SecretKey encryptionKey() throws Exception {
        KeyStore store = keyStore();
        if (store.containsAlias(ALIAS)) return (SecretKey) store.getKey(ALIAS, null);
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(
            ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT
        ).setKeySize(256)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setRandomizedEncryptionRequired(true)
            .build());
        return generator.generateKey();
    }

    @PluginMethod
    public synchronized void save(PluginCall call) {
        String value = call.getString("value");
        if (value == null || value.length() > 65536) {
            call.reject("Credential must be a JSON string of at most 64 KiB.", "INVALID_VALUE");
            return;
        }
        try {
            new JSONObject(value);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, encryptionKey());
            cipher.updateAAD(AAD);
            byte[] encrypted = cipher.doFinal(value.getBytes(StandardCharsets.UTF_8));
            boolean saved = preferences().edit()
                .putString("iv", Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP))
                .putString("ciphertext", Base64.encodeToString(encrypted, Base64.NO_WRAP))
                .commit();
            if (!saved) throw new IllegalStateException("Credential storage write failed");
            call.resolve();
        } catch (Exception error) {
            call.reject("Could not securely save pairing. Please try pairing again.", "SAVE_FAILED");
        }
    }

    @PluginMethod
    public synchronized void load(PluginCall call) {
        try {
            SharedPreferences prefs = preferences();
            String ciphertext = prefs.getString("ciphertext", null);
            JSObject result = new JSObject();
            if (ciphertext == null) {
                result.put("value", JSONObject.NULL);
            } else {
                String iv = prefs.getString("iv", null);
                SecretKey key = (SecretKey) keyStore().getKey(ALIAS, null);
                if (iv == null || key == null) throw new IllegalStateException("Pairing key unavailable");
                Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
                cipher.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(128, Base64.decode(iv, Base64.NO_WRAP)));
                cipher.updateAAD(AAD);
                byte[] plain = cipher.doFinal(Base64.decode(ciphertext, Base64.NO_WRAP));
                result.put("value", new String(plain, StandardCharsets.UTF_8));
            }
            call.resolve(result);
        } catch (Exception error) {
            call.reject("Stored pairing cannot be unlocked. Please clear it and pair again.", "LOAD_FAILED");
        }
    }

    @PluginMethod
    public synchronized void clear(PluginCall call) {
        try {
            if (!preferences().edit().clear().commit()) throw new IllegalStateException("Credential removal failed");
            historyFile().delete();
            keyStore().deleteEntry(ALIAS);
            call.resolve();
        } catch (Exception error) {
            call.reject("Could not remove stored pairing.", "CLEAR_FAILED");
        }
    }
}
