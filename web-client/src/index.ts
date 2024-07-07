import { Ecdsa, EcdsaPublicKey, Ed25519, MessageHash } from '@sodot/sodot-web-sdk-demo';

const SERVER_URL = 'http://localhost:3000';
// This client-server example will use a simple 2-of-2 MPC setting
const T = 2;
const N = 2;

export async function runClient(sigAlgo, userId) {
    // When the user signs up for the service, behind the scenes key generation can take place
    // Set up parameters for key generation
    console.log(`Running ${sigAlgo} for user ${userId}`);
    // Locally compute our keygenId
    const mpcSigner = sigAlgo == 'ecdsa' ? new Ecdsa() : new Ed25519();
    const initKeygenResult = await mpcSigner.initKeygen();
    const clientKeygenId = initKeygenResult.keygenId;
    
    // Exchange keygen params with server and run keygen
    let res = await fetch(`${SERVER_URL}/keygen/${userId}/${sigAlgo}/${clientKeygenId}`);
    const params = await res.json();
    const keygenRoomUuid = params[0];
    const serverKeygenId = params[1];

    console.log('keygenRoomUuid:', keygenRoomUuid);
    const keygenResult: any = await mpcSigner.keygen(keygenRoomUuid, N, T, initKeygenResult, [serverKeygenId]);
    console.log('CLIENT keygen done');
    let masterPubkey = keygenResult.pubkey;
    if (sigAlgo == 'ecdsa') {
        // For ecdsa, we serialize the pubkey to make it readable
        masterPubkey = (masterPubkey as EcdsaPublicKey).serializeCompressed();
    }
    console.log(`Client keygen result: ${masterPubkey},${keygenResult.secretShare}`);

    // Now that keygen is done we can use our client key material to sign messages together with the server
    // Set up parameters for signing
    // We send the message bytes as a hex string
    let message: any = '1704907f86a842a8b0ac5662384d22af48969a94e1344dd68d8e02c0fdbf1df8e7ccdb9ce3f24659b116e4f793390412';
    // We pick a derivation path - this uses standard non-hardened key derivation
    // Using key derivation paths we can have as many public keys as we want generated from just a single keygen session.
    const derivationPathStr = JSON.stringify([44,60,0,0,0]);
    const derivationPath = new Uint32Array([44,60,0,0,0]);
    res = await fetch(`${SERVER_URL}/sign/${userId}/${sigAlgo}/${message}/${derivationPathStr}`);
    const signingRoomUuid = await res.text();
    console.log('signingRoomUuid:', signingRoomUuid);
    
    // Now we sign
    let pubkey: any = await mpcSigner.derivePubkey(keygenResult, derivationPath);

    if (sigAlgo == 'ecdsa') {
        // For ecdsa, signing requires a hashed message, while ed25519 requires the raw message
        message = MessageHash.sha256(message);
        // For ecdsa, we serialize the pubkey to make it readable
        pubkey = pubkey.serializeCompressed();
    }

    console.log(`signing room id: ${signingRoomUuid}, as public key: ${pubkey}, signing message: ${message.toHex ? message.toHex() : message}`);
    let signature: any = await mpcSigner.sign(signingRoomUuid, keygenResult, message, derivationPath);
    if (sigAlgo == 'ecdsa') {
        // For ecdsa we pick the DER serialization of the signature for logging purposes, (r,s,v) representation is also available
        signature = signature.der;
    }
    console.log(`Successfully created a signature together with the server: ${signature}`);

    // Now we will refresh the key material
    res = await fetch(`${SERVER_URL}/refresh/${userId}/${sigAlgo}`);
    const refreshRoomUuid = await res.text();
    console.log('refreshRoomUuid:', refreshRoomUuid);

    const refreshedResult: any = await mpcSigner.refresh(refreshRoomUuid, keygenResult);
    
    // We will now use the refreshedResult as key material for signing (under the same public key) with the server
    let message2: any = 'c304907f86ae42a8b0aca662380d22af48969a94e1344dd68d8802c0fdbf1df8e7ccdb9ce3f24659b116e4f793390612'
    res = await fetch(`${SERVER_URL}/sign/${userId}/${sigAlgo}/${message2}/${derivationPathStr}`);
    const signingRoomUuid2 = await res.text();
    console.log('signingRoomUuid2:', signingRoomUuid2);

    // The pubkey is the same
    let pubkey2: any = await mpcSigner.derivePubkey(refreshedResult, derivationPath);
    if (sigAlgo == 'ecdsa') {
        // For ecdsa, signing requires a hashed message, while ed25519 requires the raw message
        message2 = MessageHash.sha256(message2);
        // For ecdsa, we serialize the pubkey to make it readable
        pubkey2 = pubkey2.serializeCompressed();
    }
    console.log(`As public key: ${pubkey2}, the pubkey is the same: ${JSON.stringify(pubkey) == JSON.stringify(pubkey2)}, signing message: ${message2.toHex ? message2.toHex() : message2}`);
    let signature2: any = await mpcSigner.sign(signingRoomUuid2, refreshedResult, message2, derivationPath);
    if (sigAlgo == 'ecdsa') {
        // For ecdsa we pick the DER serialization of the signature for logging purposes, (r,s,v) representation is also available
        signature2 = signature2.der;
    }
    console.log(`Successfully created a signature together with the server with the new key material: ${signature2}`);
}