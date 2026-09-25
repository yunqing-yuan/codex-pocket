package studio.codexpocket.mobile;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.nio.charset.StandardCharsets;
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
            keyStore().deleteEntry(ALIAS);
            call.resolve();
        } catch (Exception error) {
            call.reject("Could not remove stored pairing.", "CLEAR_FAILED");
        }
    }
}
