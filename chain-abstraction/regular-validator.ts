import "dotenv/config"

import {LitActionResource, LitPKPResource} from "@lit-protocol/auth-helpers";
import {LitNodeClient} from "@lit-protocol/lit-node-client";
import {PKPEthersWallet} from "@lit-protocol/pkp-ethers";
import {LIT_NETWORKS_KEYS} from "@lit-protocol/types";

import {createPublicClient, hashMessage, Hex, http, isAddress} from "viem"
import {privateKeyToAccount} from "viem/accounts"
import {getEntryPoint, KERNEL_V3_1} from "@zerodev/sdk/constants";
import {bsc, sepolia} from "viem/chains";
import {signerToEcdsaValidator} from "@zerodev/ecdsa-validator";
import {createKernelAccount, verifyEIP6492Signature} from "@zerodev/sdk";
import {LIT_ABILITY, LIT_NETWORK, LIT_RPC} from "@lit-protocol/constants";
import {ethers, providers, Signer} from "ethers";
import {ETHRequestSigningPayload} from "@lit-protocol/pkp-ethers/src/lib/pkp-ethers-types";
import {EthWalletProvider} from "@lit-protocol/lit-auth-client";
import {CONSTANTS, PushAPI} from "@pushprotocol/restapi";

const signer = privateKeyToAccount('0x8665803180babd49f9e48194cf8f78e493a3d961d0d2685abc4b1a3771925ef8' as Hex)
const NETWORK = LIT_NETWORK.DatilDev

const SEPOLIA_RPC_URL = 'https://sepolia.infura.io/v3/b6bf7d3508c941499b10025c0776eaf8'
const PKP_PUB_KEY = '0x04e48499f0f44c505a4275b2b6c83a771ef4579469ac8773daddbc0090f86d6ff9b961a9301b378afb793db3aeebe47ec3b56511f007ede8b7e10e1b3898905e51'
const PRIVATE_KEY = '0x0b21bb37586bc78fe9feab33efae4e5c11dd97d3aca9d60049cb3abf40f200fa'
const entryPoint = getEntryPoint("0.7");
const kernelVersion = KERNEL_V3_1
/*
const RPC_URL =
    'https://boldest-lingering-mansion.ethereum-sepolia.quiknode.pro/4e8ff9604fe745a7e3667de33e5e66d196fa5778/';
*/
const RPC_URL =
    'https://bsc-dataseed.binance.org/';


const isValidSCWCAIP = (wallet: string): boolean => {
    try {
        const walletComponent = wallet.split(':');
        return (
            walletComponent.length === 4 &&
            walletComponent[0] === 'scw' &&
            walletComponent[1] === 'eip155' &&
            !isNaN(Number(walletComponent[2])) &&
            Number(walletComponent[2]) > 0 &&
            isAddress(walletComponent[3])
        );
    } catch (err) {
        return false;
    }
};


class KernelSigner extends Signer {
    private readonly kernelAccount: any; // Using any since we don't have the exact type
    public override provider: providers.Provider;

    constructor(account: any, provider: providers.Provider) {
        super();
        this.kernelAccount = account;
        this.provider = provider;
    }

    async getAddress(): Promise<string> {
        return this.kernelAccount.address;
    }

    async signMessage(message: string | Uint8Array): Promise<string> {
        return await this.kernelAccount.signMessage({
            message: typeof message === 'string' ? message : { raw: message },
        });
    }

    async signTypedData(domain: any, types: any, value: any): Promise<string> {
        const primaryType = Object.keys(types).find(
            (key) => key !== 'EIP712Domain'
        );
        if (!primaryType) {
            throw new Error('No primaryType found');
        }
        return await this.kernelAccount.signTypedData({
            domain,
            types,
            primaryType,
            message: value,
        });
    }

    async signTransaction(): Promise<string> {
        throw new Error('Transaction signing not supported for Kernel account');
    }

    connect(provider: providers.Provider): KernelSigner {
        return new KernelSigner(this.kernelAccount, provider);
    }
}

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
        PRIVATE_KEY,
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
                ability: LIT_ABILITY.LitActionExecution,
            },
            {resource: new LitPKPResource("*"), ability: LIT_ABILITY.PKPSigning},
        ],
    });

    const pkpEthersWallet = new PKPEthersWallet({
        litNodeClient,
        pkpPubKey: PKP_PUB_KEY,
        controllerSessionSigs: pkpSessionSigs
    });

    pkpEthersWallet.setRpc(RPC_URL)
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


    const _savedSignMessage = pkpEthersWallet.signMessage.bind(pkpEthersWallet);
    pkpEthersWallet.signMessage = async (message: string | Uint8Array) => {
        const messageStr = message.toString();
        const isHash = messageStr.startsWith('0x') && messageStr.length === 66;
        if (isHash) {
            const sigResponse = await litNodeClient.pkpSign({
                pubKey: PKP_PUB_KEY,
                toSign: ethers.utils.arrayify(messageStr),
                sessionSigs: pkpSessionSigs
            });
            return sigResponse.signature;
        }
        return _savedSignMessage(message);
    };


    const publicClient = createPublicClient({
        transport: http(),
        chain: bsc,
    })

    //------------ test code---------------
    const viemSigner = privateKeyToAccount(PRIVATE_KEY);
    //------------ test code---------------

    // use validator as PKP wallet
    const ecdsaValidatorForPkpWallet = await signerToEcdsaValidator(publicClient, {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        // signer: pkpEthersWallet,
        signer: viemSigner,
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

    console.log('pkp signed message', await pkpEthersWallet.signMessage('Hello World'))

    console.log(
        await verifyEIP6492Signature({
            signer: accountForPkpWallet.address, // your smart account address
            hash: hashMessage("hello world"),
            signature: signatureForPkpWallet,
            client: publicClient,
        })
    );

// --- initializing pushAPI instance ------------
    const caipAddress = `scw:eip155:${publicClient.chain.id}:${accountForPkpWallet.address}`;
    const isValid = isValidSCWCAIP(caipAddress);
    console.log('Is valid CAIP address:', isValid);

    const signer1 = new KernelSigner(accountForPkpWallet, new providers.JsonRpcProvider(RPC_URL));
    const userAlice = await PushAPI.initialize(signer1, {
        account: caipAddress,
        env: CONSTANTS.ENV.STAGING,
    });

    console.log("initalized result: ", userAlice.errors.length > 0 ? 'ERROR' : 'OK!!!')
// --- end of initializing pushAPI instance ------------

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
