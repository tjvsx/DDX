import { BaseContract } from '@0x/base-contract';
import { SupportedProvider, Web3Wrapper } from '@0x/web3-wrapper';
import { getDerivaDEXContractAddressesForChainOrThrow } from '@derivadex/contract-addresses';
import * as DDX from '@derivadex/contract-artifacts/contracts/DDX.json';
import * as DDXWalletCloneable from '@derivadex/contract-artifacts/contracts/DDXWalletCloneable.json';
import * as DerivaDEX from '@derivadex/contract-artifacts/contracts/DerivaDEX.json';
import * as DIFundTokenFactory from '@derivadex/contract-artifacts/contracts/DIFundTokenFactory.json';
import * as DummyToken from '@derivadex/contract-artifacts/contracts/DummyToken.json';
import * as Governance from '@derivadex/contract-artifacts/contracts/Governance.json';
import * as InsuranceFund from '@derivadex/contract-artifacts/contracts/InsuranceFund.json';
import * as Pause from '@derivadex/contract-artifacts/contracts/Pause.json';
import * as Trader from '@derivadex/contract-artifacts/contracts/Trader.json';
import {
    AUSDTContract,
    CUSDTContract,
    DDXContract,
    DDXWalletCloneableContract,
    DerivaDEXContract,
    DIFundTokenFactoryContract,
    DummyTokenContract,
    GovernanceContract,
    InsuranceFundContract,
    PauseContract,
    SafeERC20WrapperContract,
    TraderContract,
} from '@derivadex/contract-wrappers';
import { ContractAddresses, ObjectMap } from '@derivadex/types';
import { ContractArtifact } from 'ethereum-types';

export interface DeployerConfig {
    chainId: number;
    isFork: boolean;
    isGanache: boolean;
    provider: SupportedProvider;
    useDeployedDDXToken: boolean;
}

export class Deployer {
    public accounts: string[];
    public chainId: number;
    public contracts: ObjectMap<BaseContract>;
    public isFork: boolean;
    public isGanache: boolean;
    public useDeployedDDXToken: boolean;
    public owner: string;
    public provider: SupportedProvider;

    public static getLibraryPath(libraryName: string): string {
        return `contracts/margin/impl/${libraryName}.sol:${libraryName}`;
    }

    constructor(config: DeployerConfig) {
        this.chainId = config.chainId;
        this.provider = config.provider;
        this.accounts = [];
        this.contracts = {};
        this.owner = '';
        this.isFork = config.isFork;
        this.isGanache = config.isGanache;
        this.useDeployedDDXToken = config.useDeployedDDXToken;
    }

    public async initAccountsAsync(): Promise<void> {
        console.log(' - initAccountsAsync: init Web3Wrapper ...');
        const web3Wrapper = new Web3Wrapper(this.provider);
        console.log(' - initAccountsAsync: getAvailableAddressesAsync - BEGIN');
        this.accounts = await web3Wrapper.getAvailableAddressesAsync();
        console.log(' - initAccountsAsync: getAvailableAddressesAsync - COMPLETE', this.accounts);
        this.owner = this.accounts[0];
    }

    public async deployDDXAsync(): Promise<DDXContract> {
        let ddx;
        if (this.useDeployedDDXToken) {
            const ddxAddresses = await getDerivaDEXContractAddressesForChainOrThrow(this.chainId);
            ddx = this.contracts.ddx = new DDXContract(ddxAddresses.ddxAddress, this.provider);
        } else {
            ddx = this.contracts.ddx = await DDXContract.deployFrom0xArtifactAsync(
                DDX as ContractArtifact,
                this.provider,
                { from: this.owner },
                {},
            );
        }
        return ddx;
    }

    public async deployDerivaDEXAsync(): Promise<DerivaDEXContract> {
        console.log('deployDerivaDEXAsync - deploy DerivaDEX Contract ...');
        const derivaDEX = (this.contracts.derivaDEX = await DerivaDEXContract.deployFrom0xArtifactAsync(
            DerivaDEX as ContractArtifact,
            this.provider,
            { from: this.owner },
            {},
            this.contracts.ddx.address,
        ));
        return derivaDEX;
    }

    public async distributeUSDTAsync(): Promise<void> {
        const usdtAddress = '0xdAC17F958D2ee523a2206206994597C13D831ec7';
        const cusdtAddress = '0xf650c3d88d12db855b8bf7d11be6c55a4e07dcc9';
        const ausdtAddress = '0x71fc860f7d3a592a4a98740e39db31d25db65ae8';
        const unlockedAddressUSDT = '0xD545f6EAf71b8E54aF1F02dAFBa6C0D46C491cc1';
        const unlockedAddressCUSDT = '0x0182685f547a8335ff7b48264f15e76f346e282e';
        const unlockedAddressAUSDT = '0xa97bd3094fb9bf8a666228bceffc0648358ee48f';
        const tokenCount = 500000;
        const cusdtTokenCount = 500;
        const ausdtTokenCount = 5000;

        const usdt = (this.contracts.usdt = new SafeERC20WrapperContract(usdtAddress, this.provider));
        const cusdt = (this.contracts.cusdt = new CUSDTContract(cusdtAddress, this.provider, { gas: 500000 }));
        const ausdt = (this.contracts.ausdt = new AUSDTContract(ausdtAddress, this.provider, { gas: 500000 }));
        const amount = Web3Wrapper.toBaseUnitAmount(tokenCount, 6);
        const cusdtAmount = Web3Wrapper.toBaseUnitAmount(cusdtTokenCount, 8);
        const ausdtAmount = Web3Wrapper.toBaseUnitAmount(ausdtTokenCount, 6);
        for (const account of this.accounts.slice(0, 5)) {
            if (account !== this.owner) {
                // Distributing 100 tokens to each account (we have 18 decimals)
                await usdt.transfer(account, amount).awaitTransactionSuccessAsync({ from: unlockedAddressUSDT });
                await cusdt.transfer(account, cusdtAmount).awaitTransactionSuccessAsync({ from: unlockedAddressCUSDT });
                await ausdt.transfer(account, ausdtAmount).awaitTransactionSuccessAsync({ from: unlockedAddressAUSDT });
            }
        }
    }

    public async distributeUSDTNoForkAsync(): Promise<void> {
        const usdt = (this.contracts.usdt = await DummyTokenContract.deployFrom0xArtifactAsync(
            DummyToken as ContractArtifact,
            this.provider,
            { from: this.owner, gas: 10000000 },
            {},
            'USDT',
            'USDT',
        ));
        const cusdt = (this.contracts.cusdt = await DummyTokenContract.deployFrom0xArtifactAsync(
            DummyToken as ContractArtifact,
            this.provider,
            { from: this.owner, gas: 10000000 },
            {},
            'CUSDT',
            'CUSDT',
        ));
        const ausdt = (this.contracts.ausdt = await DummyTokenContract.deployFrom0xArtifactAsync(
            DummyToken as ContractArtifact,
            this.provider,
            { from: this.owner, gas: 10000000 },
            {},
            'AUSDT',
            'AUSDT',
        ));
        const safeUSDT = new SafeERC20WrapperContract(usdt.address, this.provider);
        const safeCUSDT = new SafeERC20WrapperContract(cusdt.address, this.provider);
        const safeAUSDT = new SafeERC20WrapperContract(ausdt.address, this.provider);
        const tokenCount = 500000;
        const cusdtTokenCount = 500;
        const ausdtTokenCount = 5000;
        const amount = Web3Wrapper.toBaseUnitAmount(tokenCount, 18);
        const cusdtAmount = Web3Wrapper.toBaseUnitAmount(cusdtTokenCount, 18);
        const ausdtAmount = Web3Wrapper.toBaseUnitAmount(ausdtTokenCount, 18);
        for (const account of this.accounts.slice(0, 5)) {
            if (account !== this.owner) {
                // Distributing 100 tokens to each account (we have 18 decimals)
                await safeUSDT.transfer(account, amount).awaitTransactionSuccessAsync({ from: this.owner });
                await safeCUSDT.transfer(account, cusdtAmount).awaitTransactionSuccessAsync({ from: this.owner });
                await safeAUSDT.transfer(account, ausdtAmount).awaitTransactionSuccessAsync({ from: this.owner });
            }
        }
    }

    public async distributeUSDCAsync(): Promise<void> {
        const usdcAddress = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
        const cusdcAddress = '0x39aa39c021dfbae8fac545936693ac917d5e7563';
        const ausdcAddress = '0x9bA00D6856a4eDF4665BcA2C2309936572473B7E';
        // FIXME(jalextowle): Can we safely delete this commented code?
        //
        // const unlockedAddressCUSDC = '0x4f6742bADB049791CD9A37ea913f2BAC38d01279';
        // const unlockedAddressAUSDC = '0xa97bd3094fb9bf8a666228bceffc0648358ee48f';
        // const tokenCount = 500000;
        // const cusdcTokenCount = 500;
        // const ausdcTokenCount = 5000;

        this.contracts.usdc = new SafeERC20WrapperContract(usdcAddress, this.provider);
        this.contracts.cusdc = new CUSDTContract(cusdcAddress, this.provider, { gas: 500000 });
        this.contracts.ausdc = new AUSDTContract(ausdcAddress, this.provider, { gas: 500000 });
        // const amount = Web3Wrapper.toBaseUnitAmount(tokenCount, 6);
        // const cusdtAmount = Web3Wrapper.toBaseUnitAmount(cusdtTokenCount, 8);
        // const ausdtAmount = Web3Wrapper.toBaseUnitAmount(ausdtTokenCount, 6);
        // for (const account of this.accounts.slice(0, 5)) {
        //     if (account !== this.owner) {
        //         // Distributing 100 tokens to each account (we have 18 decimals)
        //         await usdt.transfer(account, amount).awaitTransactionSuccessAsync({from: unlockedAddressUSDT});
        //         await cusdt.transfer(account, cusdtAmount).awaitTransactionSuccessAsync({from: unlockedAddressCUSDT});
        //         await ausdt.transfer(account, ausdtAmount).awaitTransactionSuccessAsync({from: unlockedAddressAUSDT});
        //     }
        // }
    }

    public async distributeUSDCNoForkAsync(): Promise<void> {
        this.contracts.usdc = await DummyTokenContract.deployFrom0xArtifactAsync(
            DummyToken as ContractArtifact,
            this.provider,
            { from: this.owner, gas: 10000000 },
            {},
            'USDC',
            'USDC',
        );
        this.contracts.cusdc = await DummyTokenContract.deployFrom0xArtifactAsync(
            DummyToken as ContractArtifact,
            this.provider,
            { from: this.owner, gas: 10000000 },
            {},
            'CUSDC',
            'CUSDC',
        );
        this.contracts.ausdc = await DummyTokenContract.deployFrom0xArtifactAsync(
            DummyToken as ContractArtifact,
            this.provider,
            { from: this.owner, gas: 10000000 },
            {},
            'AUSDC',
            'AUSDC',
        );
        // FIXME(jalextowle): Can we safely delete this commented code?
        //
        // const safeUSDC = new SafeERC20WrapperContract(usdc.address, this.provider);
        // const safeCUSDC = new SafeERC20WrapperContract(cusdc.address, this.provider);
        // const safeAUSDC = new SafeERC20WrapperContract(ausdc.address, this.provider);
        // const tokenCount = 500000;
        // const cusdtTokenCount = 500;
        // const ausdtTokenCount = 5000;
        // const amount = Web3Wrapper.toBaseUnitAmount(tokenCount, 18);
        // const cusdtAmount = Web3Wrapper.toBaseUnitAmount(cusdtTokenCount, 18);
        // const ausdtAmount = Web3Wrapper.toBaseUnitAmount(ausdtTokenCount, 18);
        // for (const account of this.accounts.slice(0, 5)) {
        //     if (account !== this.owner) {
        //         // Distributing 100 tokens to each account (we have 18 decimals)
        //         await safeUSDT.transfer(account, amount).awaitTransactionSuccessAsync({from: this.owner});
        //         await safeCUSDT.transfer(account, cusdtAmount).awaitTransactionSuccessAsync({from: this.owner});
        //         await safeAUSDT.transfer(account, ausdtAmount).awaitTransactionSuccessAsync({from: this.owner});
        //     }
        // }
    }

    public async distributeHUSDAsync(): Promise<void> {
        const husdAddress = '0xdf574c24545e5ffecb9a659c229253d4111d87e1';
        const unlockedAddressHUSD = '0xe93381fb4c4f14bda253907b18fad305d799241a';
        const tokenCount = 1000;

        const husd = (this.contracts.husd = new SafeERC20WrapperContract(husdAddress, this.provider));
        const amount = Web3Wrapper.toBaseUnitAmount(tokenCount, 8);
        for (const account of this.accounts.slice(0, 5)) {
            if (account !== this.owner) {
                // Distributing 100 tokens to each account (we have 18 decimals)
                await husd.transfer(account, amount).awaitTransactionSuccessAsync({ from: unlockedAddressHUSD });
            }
        }
    }

    public async distributeHUSDNoForkAsync(): Promise<void> {
        const husd = (this.contracts.husd = await DummyTokenContract.deployFrom0xArtifactAsync(
            DummyToken as ContractArtifact,
            this.provider,
            { from: this.owner, gas: 10000000 },
            {},
            'HDUM',
            'HDUM',
        ));
        const safeHUSD = new SafeERC20WrapperContract(husd.address, this.provider);
        const tokenCount = 1000;
        const amount = Web3Wrapper.toBaseUnitAmount(tokenCount, 8);
        for (const account of this.accounts.slice(0, 5)) {
            if (account !== this.owner) {
                // Distributing 100 tokens to each account (we have 18 decimals)
                await safeHUSD.transfer(account, amount).awaitTransactionSuccessAsync({ from: this.owner });
            }
        }
    }

    public async distributeGUSDAsync(): Promise<void> {
        const gusdAddress = '0x056fd409e1d7a124bd7017459dfea2f387b6d5cd';
        const unlockedAddressGUSD = '0xe93381fb4c4f14bda253907b18fad305d799241a';
        const tokenCount = 1000;

        const gusd = (this.contracts.gusd = new SafeERC20WrapperContract(gusdAddress, this.provider));
        const amount = Web3Wrapper.toBaseUnitAmount(tokenCount, 8);
        for (const account of this.accounts.slice(0, 5)) {
            if (account !== this.owner) {
                // Distributing 100 tokens to each account (we have 18 decimals)
                await gusd.transfer(account, amount).awaitTransactionSuccessAsync({ from: unlockedAddressGUSD });
            }
        }
    }

    public async distributeGUSDNoForkAsync(): Promise<void> {
        const gusd = (this.contracts.gusd = await DummyTokenContract.deployFrom0xArtifactAsync(
            DummyToken as ContractArtifact,
            this.provider,
            { from: this.owner, gas: 10000000 },
            {},
            'GDUM',
            'GDUM',
        ));
        const safeGUSD = new SafeERC20WrapperContract(gusd.address, this.provider);
        const tokenCount = 1000;
        const amount = Web3Wrapper.toBaseUnitAmount(tokenCount, 8);
        for (const account of this.accounts.slice(0, 5)) {
            if (account !== this.owner) {
                // Distributing 100 tokens to each account (we have 18 decimals)
                await safeGUSD.transfer(account, amount).awaitTransactionSuccessAsync({ from: this.owner });
            }
        }
    }

    public async deployGovernanceAsync(): Promise<GovernanceContract> {
        console.log('deployGovernanceAsync - deploy Governance Contract ...');
        return (this.contracts.governance = await GovernanceContract.deployFrom0xArtifactAsync(
            Governance as ContractArtifact,
            this.provider,
            { from: this.owner, gas: 10000000 },
            {},
        ));
    }

    public async deployProtocolAsync(): Promise<void> {
        console.log('deployProtocolAsync - BEGIN');

        console.log('deployProtocolAsync - deploy InsuranceFund Contract ...');
        this.contracts.insuranceFund = await InsuranceFundContract.deployFrom0xArtifactAsync(
            InsuranceFund as ContractArtifact,
            this.provider,
            { from: this.owner, gas: 10000000 },
            {},
        );

        console.log('deployProtocolAsync - deploy Trader Contract ...');
        this.contracts.ddxWalletCloneable = await DDXWalletCloneableContract.deployFrom0xArtifactAsync(
            DDXWalletCloneable as ContractArtifact,
            this.provider,
            { from: this.owner, gas: 10000000 },
            {},
        );

        console.log('deployProtocolAsync - deploy Trader Contract ...');
        this.contracts.trader = await TraderContract.deployFrom0xArtifactAsync(
            Trader as ContractArtifact,
            this.provider,
            { from: this.owner, gas: 10000000 },
            {},
        );

        console.log('deployProtocolAsync - deploy Pause Contract ...');
        this.contracts.pause = await PauseContract.deployFrom0xArtifactAsync(
            Pause as ContractArtifact,
            this.provider,
            { from: this.owner, gas: 10000000 },
            {},
        );

        console.log('deployProtocolAsync - deploy DIFundTokenFactory Contract ...');
        this.contracts.diFundTokenFactory = await DIFundTokenFactoryContract.deployFrom0xArtifactAsync(
            DIFundTokenFactory as ContractArtifact,
            this.provider,
            { from: this.owner, gas: 10000000 },
            {},
            this.contracts.derivaDEX.address,
        );

        console.log('deployProtocolAsync - COMPLETE');
    }

    public async deployAsync(): Promise<Partial<ContractAddresses>> {
        console.log('deployAsync - BEGIN');

        console.log('- initAccountsAsync ...');
        await this.initAccountsAsync();
        console.log('- deployDDXAsync ...');
        await this.deployDDXAsync();
        console.log('- deployDerivaDEXAsync ...');
        await this.deployDerivaDEXAsync();
        console.log('- deployGovernanceAsync ...');
        await this.deployGovernanceAsync();

        if (this.isGanache) {
            console.log('- deployUSDTAsync ...');
            if (this.isFork) {
                // Unlock the accounts that we need to impersonate
                await new Web3Wrapper(this.provider).sendRawPayloadAsync({
                    method: 'hardhat_impersonateAccount',
                    params: ['0xD545f6EAf71b8E54aF1F02dAFBa6C0D46C491cc1'],
                });
                await new Web3Wrapper(this.provider).sendRawPayloadAsync({
                    method: 'hardhat_impersonateAccount',
                    params: ['0x0182685f547a8335ff7b48264f15e76f346e282e'],
                });
                await new Web3Wrapper(this.provider).sendRawPayloadAsync({
                    method: 'hardhat_impersonateAccount',
                    params: ['0xa97bd3094fb9bf8a666228bceffc0648358ee48f'],
                });

                await this.distributeUSDTAsync();
                await this.distributeUSDCAsync();

                // Re-lock the accounts that we need to impersonate
                await new Web3Wrapper(this.provider).sendRawPayloadAsync({
                    method: 'hardhat_stopImpersonatingAccount',
                    params: ['0xD545f6EAf71b8E54aF1F02dAFBa6C0D46C491cc1'],
                });
                await new Web3Wrapper(this.provider).sendRawPayloadAsync({
                    method: 'hardhat_stopImpersonatingAccount',
                    params: ['0x0182685f547a8335ff7b48264f15e76f346e282e'],
                });
                await new Web3Wrapper(this.provider).sendRawPayloadAsync({
                    method: 'hardhat_stopImpersonatingAccount',
                    params: ['0xa97bd3094fb9bf8a666228bceffc0648358ee48f'],
                });
            } else {
                await this.distributeUSDTNoForkAsync();
                await this.distributeUSDCNoForkAsync();
            }
        }

        console.log('- deployProtocolAsync ...');
        await this.deployProtocolAsync();
        console.log('deployAsync - COMPLETE');
        return {
            derivaDEXAddress: this.contracts.derivaDEX.address,
            governanceAddress: this.contracts.governance.address,
            insuranceFundAddress: this.contracts.insuranceFund.address,
            traderAddress: this.contracts.trader.address,
            pauseAddress: this.contracts.pause.address,
            ddxWalletCloneableAddress: this.contracts.ddxWalletCloneable.address,
            diFundTokenFactoryAddress: this.contracts.diFundTokenFactory.address,
            ddxAddress: this.contracts.ddx.address,
            // NOTE(jalextowle): These are marked as undefined to avoid overwriting
            // previous entries with the spread operator.
            usdtAddress: this.contracts.usdt ? this.contracts.usdt.address : undefined,
            cusdtAddress: this.contracts.cusdt ? this.contracts.cusdt.address : undefined,
            ausdtAddress: this.contracts.ausdt ? this.contracts.ausdt.address : undefined,
            usdcAddress: this.contracts.usdc ? this.contracts.usdc.address : undefined,
            cusdcAddress: this.contracts.cusdc ? this.contracts.cusdc.address : undefined,
            ausdcAddress: this.contracts.ausdc ? this.contracts.ausdc.address : undefined,
        };
    }
}
