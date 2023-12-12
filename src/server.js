import { spawn } from 'node:child_process';
import { exit } from 'node:process';
import express from 'express';
import cors from 'cors';
import { Mutex } from 'async-mutex';
import env from 'dotenv';
// Note that we use the demo version of the SDK for this example
import { Ecdsa, Ed25519, MessageHash } from '@sodot/sodot-node-sdk-demo';

// This loads the API_KEY env variable from a .env file in the project root directory
env.config();
const API_KEY = process.env.API_KEY;

// For this client-server example we use a simple 2-of-2 setting
const T = 2;
const N = 2;

// Define a port number for the server
const port = 3000;

// Create a global object to store the key-value mappings
// In reality this should be replaced with a persistent database
let db = {};
// We use a master request mutex to mitigate any data access race conditions, this is just a naive solution for this example app.
const mutex = new Mutex();

function shouldAllowSigning(message, derivationPath) {
    // Insert bussiness logic here to verify that the given message should be signed
    // Here some fraud-detection or other limitations on the messages to be signed should be enforced.
    return true;
}

function runServer() {
    // Create an Express app
    const app = express();

    // Allow CORS requests from any origin
    app.use(cors({ origin: '*' }));

    // Use JSON middleware to parse request bodies
    app.use(express.json());

    // Define the keygen endpoint
    app.get('/keygen/:userId/:sigAlgo/:keygenId', async (req, res) => {
        try {
            await mutex.runExclusive(async () => {
                // Parse the parameters
                const userId = req.params.userId;
                const sigAlgo = req.params.sigAlgo;
                const clientKeygenId = req.params.keygenId;
                const mpcSigner = sigAlgo == 'ecdsa' ? new Ecdsa() : new Ed25519();

                // Check if the userId already exists in the database
                if (db.hasOwnProperty(userId) && db[userId].hasOwnProperty(sigAlgo)) {
                    // Return a 403 error with a message
                    res.status(403).send('User already exists');
                    throw new Error('User already exists');
                }

                // Create a room and locally compute our keygenId
                const roomUuid = await mpcSigner.createRoom(N, API_KEY);
                const initKeygenResult = await mpcSigner.initKeygen();

                // Return a 200 OK status with the roomUuid and the server's keygenId
                res.status(200).send(`["${roomUuid}","${initKeygenResult.keygenId}"]`);

                // Run keygen
                const keygenResult = await mpcSigner.keygen(roomUuid, N, T, initKeygenResult, [clientKeygenId]);
                let pubkey = keygenResult.pubkey;
                if (sigAlgo == 'ecdsa') {
                    // For ecdsa, we serialize the pubkey to make it readable
                    pubkey = pubkey.serializeCompressed();
                }
                console.log(`Server keygen result: ${pubkey},${keygenResult.secretShare}`);

                // Store the keygen data for this user
                db[userId] = {};
                db[userId][sigAlgo] = {
                    'serverShare': keygenResult,
                };
            });
        } catch (e) {
            // Log any errors that arise from handling the request
            console.error(e);
        }
    });

    // Define the sign endpoint
    app.get('/sign/:userId/:sigAlgo/:message/:derivationPath', async (req, res) => {
        try {
            await mutex.runExclusive(async () => {
                // Parse the parameters
                const userId = req.params.userId;
                const sigAlgo = req.params.sigAlgo;
                let message = req.params.message;
                const derivationPath = JSON.parse(req.params.derivationPath);
                const mpcSigner = sigAlgo == 'ecdsa' ? new Ecdsa() : new Ed25519();

                // Check if the userId already exists in the database and has key material for the relevant signature algorithm
                if (!db.hasOwnProperty(userId)) {
                    // Return a 400 error with a message
                    res.status(400).send('User does not exist');
                    throw new Error('User does not exist');
                } else if (!db[userId].hasOwnProperty(sigAlgo)) {
                    res.status(400).send(`User does not have key material for ${sigAlgo} yet`);
                    throw new Error('User does not have key material');
                }

                // Create a room for signing
                const roomUuid = await mpcSigner.createRoom(N, API_KEY);
                // Return a 200 OK status with the roomUuid
                res.status(200).send(`${roomUuid}`);

                // Verify we want to participate in signing the message
                if (!shouldAllowSigning(message, derivationPath)) {
                    // Return a 403 error with a message
                    res.status(403).send(`The server does not want to sign: ${message}`);
                }

                // Now we sign with the client
                let serverShare = db[userId][sigAlgo]['serverShare'];
                let pubkey = await mpcSigner.derivePubkey(serverShare, derivationPath);

                if (sigAlgo == 'ecdsa') {
                    // For ecdsa, signing requires a hashed message, while ed25519 requires the raw message
                    message = MessageHash.sha256(message);
                    // For ecdsa, we serialize the pubkey to make it readable
                    pubkey = pubkey.serializeCompressed();
                }

                console.log(`As public key: ${pubkey}, signing message: ${message.toHex ? message.toHex() : message}`);
                let signature = await mpcSigner.sign(roomUuid, serverShare, message, derivationPath);
                if (sigAlgo == 'ecdsa') {
                    // For ecdsa we pick the DER serialization of the signature for logging purposes, (r,s,v) representation is also available
                    signature = signature.der;
                }
                console.log(`Successfully created signature together with the client: ${signature}`);
            });
        } catch (e) {
            // Log any errors that arise from handling the request
            console.error(e);
        }
    });

    // Define the refresh endpoint
    app.get('/refresh/:userId/:sigAlgo', async (req, res) => {
        try {
            await mutex.runExclusive(async () => {
                // Parse the parameters
                const userId = req.params.userId;
                const sigAlgo = req.params.sigAlgo;
                const mpcSigner = sigAlgo == 'ecdsa' ? new Ecdsa() : new Ed25519();

                // Check if the userId already exists in the database and has key material for the relevant signature algorithm
                if (!db.hasOwnProperty(userId)) {
                    // Return a 400 error with a message
                    res.status(400).send('User does not exist');
                    throw new Error('User does not exist');
                } else if (!db[userId].hasOwnProperty(sigAlgo)) {
                    res.status(400).send(`User does not have key material for ${sigAlgo} yet`);
                    throw new Error('User does not have key material');
                }

                // Create a room for refresh
                const roomUuid = await mpcSigner.createRoom(N, API_KEY);
                // Return a 200 OK status with the roomUuid
                res.status(200).send(`${roomUuid}`);

                // Now we refresh the key material for the same public key with the client
                let serverShare = db[userId][sigAlgo]['serverShare'];

                console.log(`Refreshing userId's: ${userId} share for algo: ${sigAlgo}`);
                let refreshedResult = await mpcSigner.refresh(roomUuid, serverShare);
                
                // We update the serverShare to the refreshed share, we can sign with the refreshed share for the same public key
                db[userId][sigAlgo]['serverShare'] = refreshedResult;
                console.log('Successfully refreshed the key material together with the client');
            });
        } catch (e) {
            // Log any errors that arise from handling the request
            console.error(e);
        }
    });

    app.listen(port, () => {
        console.log(`The server is running on port ${port}`);
    });
}

// This just spawns the Web Client code with a headless browser.
// Check the code in web-client/src/index.ts to see how this is set up.
async function runWebClient() {
    return new Promise((resolve, reject) => {
        const process = spawn('npm', ['run', 'e2e'], { 'cwd': 'web-client' });

        let readData = "";
        process.stdout.on('data', (data) => { console.log(`WEB STDOUT:\n${data}`); readData = data; });
        process.on('close', (code) => {
            console.log(`WEB child process exited with code ${code}`);
            if (code == 0) {
                resolve(readData);
            } else {
                reject(readData);
            }
        });
        process.stderr.on('data', (errData) => console.error(`WEB STDERR:\n${errData}`));
        process.on('error', (err) => reject(err));
    });
}

async function runClienServerFlow() {
    runServer();
    await runWebClient();
    console.log('Client-Server flow completed successfully');
    // We exit and stop the server after the client flow is done.
    exit();
}

runClienServerFlow().catch((e) => console.log(e));