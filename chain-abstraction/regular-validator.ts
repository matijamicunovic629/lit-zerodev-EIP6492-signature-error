import "dotenv/config"

import {LitAbility, LitActionResource, LitPKPResource} from "@lit-protocol/auth-helpers";
import {LitNodeClient} from "@lit-protocol/lit-node-client";
import {PKPEthersWallet} from "@lit-protocol/pkp-ethers";
import {LIT_NETWORKS_KEYS} from "@lit-protocol/types";

import {createPublicClient, hashMessage, Hex, http} from "viem"
import {privateKeyToAccount} from "viem/accounts"
import {getEntryPoint, KERNEL_V3_1} from "@zerodev/sdk/constants";
import {sepolia} from "viem/chains";
import {signerToEcdsaValidator} from "@zerodev/ecdsa-validator";
import {createKernelAccount, verifyEIP6492Signature} from "@zerodev/sdk";
import {LIT_NETWORK, LIT_RPC} from "@lit-protocol/constants";
import {ethers} from "ethers";
import {ETHRequestSigningPayload} from "@lit-protocol/pkp-ethers/src/lib/pkp-ethers-types";
import {EthWalletProvider} from "@lit-protocol/lit-auth-client";

const signer = privateKeyToAccount('0x8665803180babd49f9e48194cf8f78e493a3d961d0d2685abc4b1a3771925ef8' as Hex)
const NETWORK = LIT_NETWORK.DatilDev

const SEPOLIA_RPC_URL = 'https://sepolia.infura.io/v3/b6bf7d3508c941499b10025c0776eaf8'
const PKP_PUB_KEY = '0x04e48499f0f44c505a4275b2b6c83a771ef4579469ac8773daddbc0090f86d6ff9b961a9301b378afb793db3aeebe47ec3b56511f007ede8b7e10e1b3898905e51'
const entryPoint = getEntryPoint("0.7");
const kernelVersion = KERNEL_V3_1

const main = async () => {
    console.log("connecting lit node client")
    const litNodeClient = new LitNodeClient({
        litNetwork: NETWORK as LIT_NETWORKS_KEYS,
        debug: false,
    });
    await litNodeClient.connect();
    console.log("connected lit node client")

    // ------------ begin of connecting pkp wallet with public key --------------
    const ethersWallet = new ethers.Wallet(
        '0x0b21bb37586bc78fe9feab33efae4e5c11dd97d3aca9d60049cb3abf40f200fa',
        new ethers.providers.JsonRpcProvider(LIT_RPC.CHRONICLE_YELLOWSTONE)
    );

    const authMethod = await EthWalletProvider.authenticate({
        signer: ethersWallet,
        litNodeClient,
    });


    const pkpSessionSigs = await litNodeClient.getPkpSessionSigs({
        pkpPublicKey: PKP_PUB_KEY,
        chain: "ethereum",
        authMethods: [authMethod],
        resourceAbilityRequests: [
            {
                resource: new LitActionResource("*"),
                ability: LitAbility.LitActionExecution,
            },
            {resource: new LitPKPResource("*"), ability: LitAbility.PKPSigning},
        ],
    });

    const pkpEthersWallet = new PKPEthersWallet({
        litNodeClient,
        pkpPubKey: PKP_PUB_KEY,
        controllerSessionSigs: pkpSessionSigs
    });

    pkpEthersWallet.setRpc(SEPOLIA_RPC_URL)
    console.log("pkpEthersWallet address", pkpEthersWallet.address)
    // ------------ end of connecting pkp wallet with public key --------------

    // --- since pkpEthersWallet do not provide eth_accounts request, we need to handle it ---
    const _savedRequestFunc = pkpEthersWallet.request
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    pkpEthersWallet.request = async (payload: any) => {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        if (payload?.method === 'eth_accounts' || payload?.method === 'eth_requestAccounts') {
            return [pkpEthersWallet.address]
        } else {
            return await _savedRequestFunc(payload as ETHRequestSigningPayload)
        }
    }
    // ----------------------------------------------------------------------------------------

    const publicClient = createPublicClient({
        transport: http(),
        chain: sepolia,
    })

    // use validator as PKP wallet
    const ecdsaValidatorForPkpWallet = await signerToEcdsaValidator(publicClient, {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        signer: pkpEthersWallet,
        entryPoint,
        kernelVersion
    })

    const accountForPkpWallet = await createKernelAccount(publicClient, {
        plugins: {
            sudo: ecdsaValidatorForPkpWallet,
        },
        entryPoint,
        kernelVersion
    })

    const signatureForPkpWallet = await accountForPkpWallet.signMessage({
        message: "hello world",
    });

    console.log(
        await verifyEIP6492Signature({
            signer: accountForPkpWallet.address, // your smart account address
            hash: hashMessage("hello world"),
            signature: signatureForPkpWallet,
            client: publicClient,
        })
    );




    // use validator as EOA wallet
    const ecdsaValidatorForEOAWallet = await signerToEcdsaValidator(publicClient, {
        signer,
        entryPoint,
        kernelVersion
    })

    const accountForEOAWallet = await createKernelAccount(publicClient, {
        plugins: {
            sudo: ecdsaValidatorForEOAWallet,
        },
        entryPoint,
        kernelVersion
    })

    const signatureForEOAWallet = await accountForEOAWallet.signMessage({
        message: "hello world",
    });

    console.log(
        await verifyEIP6492Signature({
            signer: accountForEOAWallet.address, // your smart account address
            hash: hashMessage("hello world"),
            signature: signatureForEOAWallet,
            client: publicClient,
        })
    );

}

main()
