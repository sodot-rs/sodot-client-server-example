import { spawn } from 'node:child_process';
import { exit } from 'node:process';
import express from 'express';
import cors from 'cors';
import { Mutex } from 'async-mutex';
import env from 'dotenv';

// This loads the VERTEX_API_KEY env variable from a .env file in the project root directory
env.config();
const VERTEX_API_KEY = process.env.VERTEX_API_KEY;
// Note that we use a Vertex compatible with the demo version of the SDK for this example
const VERTEX_URL = 'https://vertex-demo-0.sodot.dev';

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

// Helper function to send a POST request to the server
async function postData(apiEndpoint, data = {}, isJson = true) {
    const response = await fetch(`${VERTEX_URL}/${apiEndpoint}`, {
        method: "POST",
        headers: {
            "Authorization": VERTEX_API_KEY,
            "Content-Type": "application/json",
        },
        body: JSON.stringify(data),
    });
    if (!response.ok) {
        throw new Error(`Failed to post data to ${apiEndpoint}: ${response.status}, ${await response.text()}`);
    }
    if (isJson) {
        return response.json();
    }
    return response;
}

// Helper function to send a GET request to the server
async function getData(apiEndpoint, isJson = true) {
    const response = await fetch(`${VERTEX_URL}/${apiEndpoint}`, {
        method: "GET",
        headers: {
            "Authorization": VERTEX_API_KEY,
            "Content-Type": "application/json",
        },
    });
    if (isJson) {
        return response.json();
    }
    return response;
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

                // Check if the userId already exists in the database
                if (db.hasOwnProperty(userId) && db[userId].hasOwnProperty(sigAlgo)) {
                    // Return a 403 error with a message
                    res.status(403).send('User already exists');
                    throw new Error('User already exists');
                }

                // Create a room and create a key_id for the keygen
                const roomUuid = (await postData('create-room', { room_size: N })).room_uuid;
                const keygenInitData = await getData(`${sigAlgo}/create`);

                // Return a 200 OK status with the roomUuid and the server's keygen id
                res.status(200).send(`["${roomUuid}","${keygenInitData.keygen_id}"]`);

                // Run keygen
                const keygenData = {
                    key_id: keygenInitData.key_id,
                    num_parties: N,
                    others_keygen_ids: [clientKeygenId],
                    room_uuid: roomUuid,
                    threshold: T
                };
                const result = await postData(`${sigAlgo}/keygen`, keygenData, false);
                console.log(`SERVER Keygen is done: ${JSON.stringify(result)}, ${JSON.stringify(keygenData)}`);

                // Store the key id data for this user
                db[userId] = {};
                db[userId][sigAlgo] = { keyId: keygenInitData.key_id };
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
                const roomUuid = (await postData('create-room', { room_size: T })).room_uuid;
                // Return a 200 OK status with the roomUuid
                res.status(200).send(`${roomUuid}`);

                // Verify we want to participate in signing the message
                if (!shouldAllowSigning(message, derivationPath)) {
                    // Return a 403 error with a message
                    res.status(403).send(`The server does not want to sign: ${message}`);
                }

                // Now we sign with the client
                let keyId = db[userId][sigAlgo]['keyId'];

                // For ecdsa we specify the hash to apply to the message before signing
                const hashAlgo = sigAlgo == 'ecdsa' ? 'SHA256' : undefined;
                // For ecdsa we convert the message to a hex string
                const messageToSign = sigAlgo == 'ecdsa' ? message.split("").map(c => c.charCodeAt(0).toString(16).padStart(2, "0")).join("") : message;
                const signData = {
                    key_id: keyId,
                    room_uuid: roomUuid,
                    derivation_path: derivationPath,
                    msg: messageToSign,
                    hash_algo: hashAlgo,
                };
                const result = await postData(`${sigAlgo}/sign`, signData);
                console.log(`Successfully created signature together with the client: ${JSON.stringify(result)}`);
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

                // Check if the userId already exists in the database and has key material for the relevant signature algorithm
                if (!db.hasOwnProperty(userId)) {
                    // Return a 400 error with a message
                    res.status(400).send('User does not exist');
                    throw new Error('User does not exist');
                } else if (!db[userId].hasOwnProperty(sigAlgo)) {
                    res.status(400).send(`User does not have key material for ${sigAlgo} yet`);
                    throw new Error('User does not have key material');
                }

                // Create a room and create a key_id for the refresh
                const roomUuid = (await postData('create-room', { room_size: N })).room_uuid;
                // Return a 200 OK status with the roomUuid
                res.status(200).send(`${roomUuid}`);

                // Now we refresh the key material for the same public key with the client
                let keyId = db[userId][sigAlgo]['keyId'];

                const newKeyId = (await postData(`${sigAlgo}/refresh`, { key_id: keyId, room_uuid: roomUuid })).key_id;

                // We update the keyId to the refreshed share, we can sign with the refreshed share for the same public key
                db[userId][sigAlgo]['keyId'] = newKeyId;
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