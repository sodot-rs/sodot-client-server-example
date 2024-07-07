# Example Client-Server Webapp Using Sodot MPC SDK and Vertex
This is a minimal example project of both an Express.js server and a simple website that leverages Sodot MPC SDK and Vertex for creating distributed private keys for both ECDSA (on secp256k1) and Ed25519 signature algorithms, as well as threshold signing using MPC.  
More information on Sodot MPC SDK and Vertex can be found in Sodot's [technical docs](https://docs.sodot.dev/docs/intro).

## Project Structure
There are 2 npm projects in this repo.  
The server at the root directory and a web client code in the `web-client` directory.  
- All server code is in javascipt and found in `src/server.js`
- The client code is in Typescript found in `web-client/src/index.ts`
    - The `web-client` project is written in Typescript just to showcase how using Typescript works with the SDK.
    - The `web-client` utilizes [Karma](https://karma-runner.github.io/6.4/index.html) in order to run the web app itself in a headless browser to make it easier to run the full client-server flow from within the root Node project.
        - Any details associated with Karma are not particularly interesting for the project.
    - Due to how Karma works, the actual client-side code that calls the logic in `web-client/src/index.ts` is in `web-client/spec/index.spec.js`.

## Project Flow
First, the server is run and exposes a REST API with endpoints for [`keygen`](https://docs.sodot.dev/docs/api-ref/node-sdk/classes/Ecdsa#keygen), [`sign`](https://docs.sodot.dev/docs/api-ref/node-sdk/classes/Ecdsa#sign), and [`refresh`](https://docs.sodot.dev/docs/api-ref/node-sdk/classes/Ecdsa#refresh).  
Then, the `web-client` is run in a headless browser.  
The `web-client` does the following:
- A keygen flow with the server, resulting in the client and server each holding a key share for a 2-of-2 controlled public key. Note that in practice the server is using the Vertex to store its key share.
- A signing flow, signing a message together with the server, here key derivation is utilized to showcase that many different public keys can be used based on 1 underlying keygen session.
- A refresh flow, this results in new (fresh) key shares for both the client and the server for the same public key (and all key derivation of the master public key).
- Finally another signing flow, to showcase how the new key shares generate valid signatures for the same public key.

## Running the Project
### Setup
First, you will need a `VERTEX_API_KEY` and an `NPM_TOKEN`. This can be requested from the [Sodot team](mailto:sdk@sodot.dev).  
Add your `NPM_TOKEN` to your environment variables:
```bash
export NPM_TOKEN="YOUR_NPM_TOKEN"
```
Create a file in the root directory of this repo named `.env`, in it add the following line:

```bash
VERTEX_API_KEY=<YOUR_API_KEY>
```

Now, install all necessary packages for the server and the `web-client`.
```bash
npm i
cd web-client && npm i
```
### Running the Client-Server Flow
From the root directory of the project run:
```bash
node src/server.js
```