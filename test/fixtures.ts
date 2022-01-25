import { Derivadex } from '@derivadex/contract-wrappers';
import { JsonRpcSigner } from 'ethers/providers';

export const USDT = {
    collateralName: 'DerivaDEX Insurance USDT',
    collateralSymbol: 'DDX-INS-USDT',
    collateralAddress: '0xdac17f958d2ee523a2206206994597c13d831ec7',
    collateralStakingType: 0,
};

export const CUSDT = {
    collateralName: 'DerivaDEX Insurance cUSDT',
    collateralSymbol: 'DDX-INS-CUSDT',
    collateralAddress: '0xf650c3d88d12db855b8bf7d11be6c55a4e07dcc9',
    collateralStakingType: 1,
};

export const AUSDT = {
    collateralName: 'DerivaDEX Insurance aUSDT',
    collateralSymbol: 'DDX-INS-AUSDT',
    collateralAddress: '0x71fc860f7d3a592a4a98740e39db31d25db65ae8',
    collateralStakingType: 2,
};

export const USDC = {
    collateralName: 'DerivaDEX Insurance USDC',
    collateralSymbol: 'DDX-INS-USDC',
    collateralAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    collateralStakingType: 0,
};

export const CUSDC = {
    collateralName: 'DerivaDEX Insurance cUSDC',
    collateralSymbol: 'DDX-INS-CUSDC',
    collateralAddress: '0x39aa39c021dfbae8fac545936693ac917d5e7563',
    collateralStakingType: 1,
};

export const AUSDC = {
    collateralName: 'DerivaDEX Insurance aUSDC',
    collateralSymbol: 'DDX-INS-AUSDC',
    collateralAddress: '0x9bA00D6856a4eDF4665BcA2C2309936572473B7E',
    collateralStakingType: 2,
};

export const HUSD = {
    collateralName: 'DerivaDEX Insurance HUSD',
    collateralSymbol: 'DDX-INS-HUSD',
    collateralAddress: '0xdf574c24545e5ffecb9a659c229253d4111d87e1',
    collateralStakingType: 0,
};

export const GUSD = {
    collateralName: 'DerivaDEX Insurance GUSD',
    collateralSymbol: 'DDX-INS-GUSD',
    collateralAddress: '0x056fd409e1d7a124bd7017459dfea2f387b6d5cd',
    collateralStakingType: 0,
};

export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

export class Fixtures {
    public derivadex: Derivadex;
    public accounts: string[];
    public owner?: string;

    constructor(derivadex: Derivadex, accounts: string[], owner?: string) {
        this.derivadex = derivadex;
        this.accounts = accounts;
        this.owner = owner;
    }

    public signer(address: string): JsonRpcSigner {
        return this.derivadex.provider.getSigner(address);
    }

    public derivaDEXWallet(): string {
        return this.owner !== undefined ? this.owner : this.accounts[0];
    }

    public traderA(): string {
        return this.accounts[1];
    }

    public traderB(): string {
        return this.accounts[2];
    }

    public traderC(): string {
        return this.accounts[3];
    }

    public traderD(): string {
        return this.accounts[4];
    }

    public traderE(): string {
        return this.accounts[5];
    }

    public traderF(): string {
        return this.accounts[6];
    }

    public operatingAddress(): string {
        return this.accounts[9];
    }
}
