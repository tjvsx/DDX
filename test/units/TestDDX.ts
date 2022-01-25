import { Web3Wrapper } from '@0x/web3-wrapper';
import { Derivadex } from '@derivadex/contract-wrappers';
import { advanceBlocksAsync, getBlockNumberAsync, setExpiryAsync } from '@derivadex/dev-utils';
import { expect } from '@derivadex/test-utils';
import * as hardhat from 'hardhat';

import { setupWithProviderAsync } from '../../deployment/setup';
import { Fixtures, ZERO_ADDRESS } from '../fixtures';

describe('#DDX', () => {
    let derivadex: Derivadex;
    let accounts: string[];
    let owner: string;
    let fixtures: Fixtures;

    describe('DDX Tests - #1', () => {
        before(async () => {
            // Reset the hardhat network provider to a fresh state.
            const provider = hardhat.network.provider;
            const web3Wrapper = new Web3Wrapper(provider);
            await web3Wrapper.sendRawPayloadAsync<void>({
                method: 'hardhat_reset',
                params: [],
            });

            ({ derivadex, accounts, owner } = await setupWithProviderAsync(hardhat.network.provider, {
                isFork: false,
                isGanache: true,
                useDeployedDDXToken: false,
            }));
            fixtures = new Fixtures(derivadex, accounts, owner);

            await derivadex
                .transferDDX(fixtures.traderB(), 10000)
                .awaitTransactionSuccessAsync({ from: fixtures.derivaDEXWallet() });
            await derivadex
                .transferDDX(fixtures.traderC(), 5000)
                .awaitTransactionSuccessAsync({ from: fixtures.derivaDEXWallet() });
            await advanceBlocksAsync(derivadex.providerEngine, 1);
        });

        it('checks that ETH cannot be sent directly to the DerivaDEX contract', async () => {
            const web3Wrapper = derivadex.getWeb3Wrapper();
            await expect(
                web3Wrapper.sendTransactionAsync({
                    from: fixtures.traderA(),
                    to: derivadex.derivaDEXContract.address,
                    value: '100',
                }),
            ).to.be.rejectedWith('DerivaDEX does not directly accept ether.');
        });

        it('checks pre-mine and liquidity mining balances', async () => {
            const derivaDEXWalletBalance = await derivadex.getBalanceOfDDXAsync(fixtures.derivaDEXWallet());
            const traderABalance = await derivadex.getBalanceOfDDXAsync(fixtures.traderA());
            const traderBBalance = await derivadex.getBalanceOfDDXAsync(fixtures.traderB());
            const traderCBalance = await derivadex.getBalanceOfDDXAsync(fixtures.traderC());
            expect(derivaDEXWalletBalance).to.be.bignumber.eq(49985000);
            expect(traderABalance).to.be.bignumber.eq(0);
            expect(traderBBalance).to.be.bignumber.eq(10000);
            expect(traderCBalance).to.be.bignumber.eq(5000);

            // const supplyState = await derivadex.getCOMPOwedAsync(fixtures.traderA(), '0xf650c3d88d12db855b8bf7d11be6c55a4e07dcc9');
            // console.log('init COMP balance', await derivadex.getBalanceOfCOMPAsync(fixtures.traderA()));
            // const claimCompTx = await derivadex.claimComp(fixtures.traderA()).awaitTransactionSuccessAsync({from: fixtures.traderA()});
            // console.log('fin COMP balance', await derivadex.getBalanceOfCOMPAsync(fixtures.traderA()));
        });

        it('ensures everyone has the proper vote count', async () => {
            await advanceBlocksAsync(derivadex.providerEngine, 1);
            const blockNumber = (await getBlockNumberAsync(derivadex.providerEngine)) - 1;
            const derivaDEXWalletPriorVotes = await derivadex.getPriorVotesDDXAsync(
                fixtures.derivaDEXWallet(),
                blockNumber,
            );
            const traderAPriorVotes = await derivadex.getPriorVotesDDXAsync(fixtures.traderA(), blockNumber);
            const traderBPriorVotes = await derivadex.getPriorVotesDDXAsync(fixtures.traderB(), blockNumber);
            const traderCPriorVotes = await derivadex.getPriorVotesDDXAsync(fixtures.traderC(), blockNumber);
            expect(derivaDEXWalletPriorVotes).to.be.bignumber.eq(49985000);
            expect(traderAPriorVotes).to.be.bignumber.eq(0);
            expect(traderBPriorVotes).to.be.bignumber.eq(10000);
            expect(traderCPriorVotes).to.be.bignumber.eq(5000);
        });

        it('ensures delegation results in correct vote count', async () => {
            // We skip delegating derivaDEXWallet and traderA to
            // themselves since its unecessary, but for good measure
            // we manually delegate traderB to itself to confirm that,
            // although unecessary, is still functional
            await derivadex.delegateDDX(fixtures.traderB()).awaitTransactionSuccessAsync({ from: fixtures.traderB() });
            const derivaDEXWalletDelegatee = await derivadex.getDelegatee(fixtures.derivaDEXWallet());
            const traderADelegatee = await derivadex.getDelegatee(fixtures.traderA());
            const traderBDelegatee = await derivadex.getDelegatee(fixtures.traderB());
            expect(derivaDEXWalletDelegatee).to.eq(fixtures.derivaDEXWallet());
            expect(traderADelegatee).to.eq(fixtures.traderA());
            expect(traderBDelegatee).to.eq(fixtures.traderB());
            const expiry = await setExpiryAsync(derivadex.providerEngine, 100e9);
            const signatureForDelegation = await derivadex.getSignatureForDelegationAsync(
                fixtures.traderD(),
                0,
                expiry,
                fixtures.traderC(),
            );
            await derivadex
                .delegateBySigDDX(fixtures.traderD(), 0, expiry, signatureForDelegation)
                .awaitTransactionSuccessAsync({ from: fixtures.traderC() });
            const traderCDelegatee = await derivadex.getDelegatee(fixtures.traderC());
            expect(traderCDelegatee).to.eq(fixtures.traderD());

            await advanceBlocksAsync(derivadex.providerEngine, 1);

            const blockNumber = (await getBlockNumberAsync(derivadex.providerEngine)) - 1;
            const derivaDEXWalletPriorVotes = await derivadex.getPriorVotesDDXAsync(
                fixtures.derivaDEXWallet(),
                blockNumber,
            );
            const traderAPriorVotes = await derivadex.getPriorVotesDDXAsync(fixtures.traderA(), blockNumber);
            const traderBPriorVotes = await derivadex.getPriorVotesDDXAsync(fixtures.traderB(), blockNumber);
            const traderCPriorVotes = await derivadex.getPriorVotesDDXAsync(fixtures.traderC(), blockNumber);
            const traderDPriorVotes = await derivadex.getPriorVotesDDXAsync(fixtures.traderD(), blockNumber);
            expect(derivaDEXWalletPriorVotes).to.be.bignumber.eq(49985000);
            expect(traderAPriorVotes).to.be.bignumber.eq(0);
            expect(traderBPriorVotes).to.be.bignumber.eq(10000);
            expect(traderCPriorVotes).to.be.bignumber.eq(0);
            expect(traderDPriorVotes).to.be.bignumber.eq(5000);
        });

        it('transfers from a trader to another', async () => {
            await derivadex
                .transferDDX(fixtures.traderE(), 1000)
                .awaitTransactionSuccessAsync({ from: fixtures.traderB() });
            await advanceBlocksAsync(derivadex.providerEngine, 1);

            const blockNumber = (await getBlockNumberAsync(derivadex.providerEngine)) - 1;
            const traderBPriorVotes = await derivadex.getPriorVotesDDXAsync(fixtures.traderB(), blockNumber);
            const traderEPriorVotes = await derivadex.getPriorVotesDDXAsync(fixtures.traderE(), blockNumber);
            expect(traderBPriorVotes).to.be.bignumber.eq(9000);
            expect(traderEPriorVotes).to.be.bignumber.eq(1000);
        });

        it('approves another users to transfer on behalf', async () => {
            const preAllowance = await derivadex.getAllowanceDDXAsync(fixtures.traderB(), fixtures.traderA());
            expect(preAllowance).to.be.bignumber.eq(0);
            await derivadex
                .approveDDX(fixtures.traderA(), 1000)
                .awaitTransactionSuccessAsync({ from: fixtures.traderB() });
            const postAllowance = await derivadex.getAllowanceDDXAsync(fixtures.traderB(), fixtures.traderA());
            expect(postAllowance).to.be.bignumber.eq(1000);
            await derivadex
                .transferFromDDX(fixtures.traderB(), fixtures.traderC(), 1000)
                .awaitTransactionSuccessAsync({ from: fixtures.traderA() });
            const remainingAllowance = await derivadex.getAllowanceDDXAsync(fixtures.traderB(), fixtures.traderA());
            expect(remainingAllowance).to.be.bignumber.eq(0);
            await advanceBlocksAsync(derivadex.providerEngine, 1);
            const blockNumber = (await getBlockNumberAsync(derivadex.providerEngine)) - 1;
            const traderBPriorVotes = await derivadex.getPriorVotesDDXAsync(fixtures.traderB(), blockNumber);
            const traderCPriorVotes = await derivadex.getPriorVotesDDXAsync(fixtures.traderC(), blockNumber);
            const traderDPriorVotes = await derivadex.getPriorVotesDDXAsync(fixtures.traderD(), blockNumber);
            expect(traderBPriorVotes).to.be.bignumber.eq(8000);
            expect(traderCPriorVotes).to.be.bignumber.eq(0);
            expect(traderDPriorVotes).to.be.bignumber.eq(6000);
        });

        it('fails to transfers ownership of DDX to another address from unauthorized address', async () => {
            const tx = derivadex
                .transferOwnershipToDerivaDEXProxyDDX(fixtures.traderE())
                .awaitTransactionSuccessAsync({ from: fixtures.traderA() });
            return expect(tx).to.be.rejectedWith('DDX: unauthorized transfer of ownership.');
        });

        it('fails to transfers ownership of DDX to the zero address', async () => {
            const initialIssuer = await derivadex.getIssuerDDXAsync();
            const tx = derivadex
                .transferOwnershipToDerivaDEXProxyDDX(ZERO_ADDRESS)
                .awaitTransactionSuccessAsync({ from: initialIssuer });
            return expect(tx).to.be.rejectedWith('DDX: transferring to zero address.');
        });

        it('transfers ownership of DDX to another address', async () => {
            const initialIssuer = await derivadex.getIssuerDDXAsync();
            expect(initialIssuer).to.eq(fixtures.derivaDEXWallet());
            await derivadex
                .transferOwnershipToDerivaDEXProxyDDX(fixtures.traderE())
                .awaitTransactionSuccessAsync({ from: fixtures.derivaDEXWallet() });
            const finalIssuer = await derivadex.getIssuerDDXAsync();
            expect(finalIssuer).to.eq(fixtures.traderE());
        });

        it('fails to transfers ownership of DDX since already done once', async () => {
            const tx = derivadex
                .transferOwnershipToDerivaDEXProxyDDX(fixtures.traderA())
                .sendTransactionAsync({ from: fixtures.traderE() });
            return expect(tx).to.be.rejectedWith('DDX: ownership already transferred.');
        });

        it('fails to mint DDX from unauthorized issuer', async () => {
            const tx = derivadex.mintDDX(fixtures.traderA(), 5000).sendTransactionAsync({ from: fixtures.traderA() });
            return expect(tx).to.be.rejectedWith('DDX: unauthorized mint.');
        });

        it('mints DDX to addresses', async () => {
            const initialDDXBalanceB = await derivadex.getBalanceOfDDXAsync(fixtures.traderB());
            const initialDDXBalanceC = await derivadex.getBalanceOfDDXAsync(fixtures.traderC());
            const initialDDXBalanceD = await derivadex.getBalanceOfDDXAsync(fixtures.traderD());
            const initialDDXBalanceE = await derivadex.getBalanceOfDDXAsync(fixtures.traderE());
            const initialDDXBalanceF = await derivadex.getBalanceOfDDXAsync(fixtures.traderF());
            expect(initialDDXBalanceB).to.be.bignumber.eq(8000);
            expect(initialDDXBalanceC).to.be.bignumber.eq(6000);
            expect(initialDDXBalanceD).to.be.bignumber.eq(0);
            expect(initialDDXBalanceE).to.be.bignumber.eq(1000);
            expect(initialDDXBalanceF).to.be.bignumber.eq(0);

            let blockNumber = (await getBlockNumberAsync(derivadex.providerEngine)) - 1;
            const initialDDXCurrentVotesB = await derivadex.getCurrentVotesAsync(fixtures.traderB());
            const initialDDXPriorVotesB = await derivadex.getPriorVotesDDXAsync(fixtures.traderB(), blockNumber);
            const initialDDXPriorVotesC = await derivadex.getPriorVotesDDXAsync(fixtures.traderC(), blockNumber);
            const initialDDXPriorVotesD = await derivadex.getPriorVotesDDXAsync(fixtures.traderD(), blockNumber);
            const initialDDXPriorVotesE = await derivadex.getPriorVotesDDXAsync(fixtures.traderE(), blockNumber);
            const initialDDXPriorVotesF = await derivadex.getPriorVotesDDXAsync(fixtures.traderF(), blockNumber);
            expect(initialDDXCurrentVotesB).to.be.bignumber.eq(8000);
            expect(initialDDXPriorVotesB).to.be.bignumber.eq(8000);
            expect(initialDDXPriorVotesC).to.be.bignumber.eq(0);
            expect(initialDDXPriorVotesD).to.be.bignumber.eq(6000);
            expect(initialDDXPriorVotesE).to.be.bignumber.eq(1000);
            expect(initialDDXPriorVotesF).to.be.bignumber.eq(0);

            const initialSupplyInfoDDX = await derivadex.getSupplyInfoDDXAsync();
            expect(initialSupplyInfoDDX.issuedSupply).to.be.bignumber.eq(50000000);
            expect(initialSupplyInfoDDX.totalSupply).to.be.bignumber.eq(50000000);

            await derivadex
                .mintDDX(fixtures.traderB(), 1000)
                .awaitTransactionSuccessAsync({ from: fixtures.traderE() });
            await derivadex
                .mintDDX(fixtures.traderC(), 1000)
                .awaitTransactionSuccessAsync({ from: fixtures.traderE() });
            await derivadex
                .mintDDX(fixtures.traderD(), 1000)
                .awaitTransactionSuccessAsync({ from: fixtures.traderE() });
            await derivadex
                .mintDDX(fixtures.traderE(), 1000)
                .awaitTransactionSuccessAsync({ from: fixtures.traderE() });
            await derivadex
                .mintDDX(fixtures.traderF(), 1000)
                .awaitTransactionSuccessAsync({ from: fixtures.traderE() });

            await advanceBlocksAsync(derivadex.providerEngine, 1);
            blockNumber = (await getBlockNumberAsync(derivadex.providerEngine)) - 1;

            const finalDDXBalanceB = await derivadex.getBalanceOfDDXAsync(fixtures.traderB());
            const finalDDXBalanceC = await derivadex.getBalanceOfDDXAsync(fixtures.traderC());
            const finalDDXBalanceD = await derivadex.getBalanceOfDDXAsync(fixtures.traderD());
            const finalDDXBalanceE = await derivadex.getBalanceOfDDXAsync(fixtures.traderE());
            const finalDDXBalanceF = await derivadex.getBalanceOfDDXAsync(fixtures.traderF());
            expect(finalDDXBalanceB).to.be.bignumber.eq(9000);
            expect(finalDDXBalanceC).to.be.bignumber.eq(7000);
            expect(finalDDXBalanceD).to.be.bignumber.eq(1000);
            expect(finalDDXBalanceE).to.be.bignumber.eq(2000);
            expect(finalDDXBalanceF).to.be.bignumber.eq(1000);

            const finalDDXPriorVotesB = await derivadex.getPriorVotesDDXAsync(fixtures.traderB(), blockNumber);
            const finalDDXPriorVotesC = await derivadex.getPriorVotesDDXAsync(fixtures.traderC(), blockNumber);
            const finalDDXPriorVotesD = await derivadex.getPriorVotesDDXAsync(fixtures.traderD(), blockNumber);
            const finalDDXPriorVotesE = await derivadex.getPriorVotesDDXAsync(fixtures.traderE(), blockNumber);
            const finalDDXPriorVotesF = await derivadex.getPriorVotesDDXAsync(fixtures.traderF(), blockNumber);
            expect(finalDDXPriorVotesB).to.be.bignumber.eq(9000);
            expect(finalDDXPriorVotesC).to.be.bignumber.eq(0);
            expect(finalDDXPriorVotesD).to.be.bignumber.eq(8000);
            expect(finalDDXPriorVotesE).to.be.bignumber.eq(2000);
            expect(finalDDXPriorVotesF).to.be.bignumber.eq(1000);

            const finalSupplyInfoDDX = await derivadex.getSupplyInfoDDXAsync();
            expect(finalSupplyInfoDDX.issuedSupply).to.be.bignumber.eq(50005000);
            expect(finalSupplyInfoDDX.totalSupply).to.be.bignumber.eq(50005000);
        });

        it('fails to burn too many tokens', async () => {
            const tx = derivadex.burnDDX(20000).sendTransactionAsync({ from: fixtures.traderB() });
            return expect(tx).to.be.rejectedWith('DDX: not enough balance to burn.');
        });

        it('fails to burn from with an unauthorized address', async () => {
            const tx = derivadex
                .burnFromDDX(fixtures.traderB(), 20000)
                .sendTransactionAsync({ from: fixtures.traderC() });
            return expect(tx).to.be.rejectedWith('DDX: burn amount exceeds allowance.');
        });

        it('fails to burn from too many tokens', async () => {
            await derivadex
                .approveDDX(fixtures.traderC(), 20000)
                .awaitTransactionSuccessAsync({ from: fixtures.traderB() });
            const tx = derivadex
                .burnFromDDX(fixtures.traderB(), 20000)
                .sendTransactionAsync({ from: fixtures.traderC() });
            return expect(tx).to.be.rejectedWith('DDX: not enough balance to burn.');
        });

        it('burns DDX from addresses', async () => {
            await derivadex.burnDDX(500).awaitTransactionSuccessAsync({ from: fixtures.traderB() });
            await derivadex
                .burnFromDDX(fixtures.traderB(), 500)
                .awaitTransactionSuccessAsync({ from: fixtures.traderC() });
            await derivadex.burnDDX(500).awaitTransactionSuccessAsync({ from: fixtures.traderC() });
            await derivadex.burnDDX(500).awaitTransactionSuccessAsync({ from: fixtures.traderD() });
            await derivadex.burnDDX(500).awaitTransactionSuccessAsync({ from: fixtures.traderE() });
            await derivadex.burnDDX(500).awaitTransactionSuccessAsync({ from: fixtures.traderF() });

            await advanceBlocksAsync(derivadex.providerEngine, 1);
            const blockNumber = (await getBlockNumberAsync(derivadex.providerEngine)) - 1;

            const finalDDXBalanceB = await derivadex.getBalanceOfDDXAsync(fixtures.traderB());
            const finalDDXBalanceC = await derivadex.getBalanceOfDDXAsync(fixtures.traderC());
            const finalDDXBalanceD = await derivadex.getBalanceOfDDXAsync(fixtures.traderD());
            const finalDDXBalanceE = await derivadex.getBalanceOfDDXAsync(fixtures.traderE());
            const finalDDXBalanceF = await derivadex.getBalanceOfDDXAsync(fixtures.traderF());
            expect(finalDDXBalanceB).to.be.bignumber.eq(8000);
            expect(finalDDXBalanceC).to.be.bignumber.eq(6500);
            expect(finalDDXBalanceD).to.be.bignumber.eq(500);
            expect(finalDDXBalanceE).to.be.bignumber.eq(1500);
            expect(finalDDXBalanceF).to.be.bignumber.eq(500);

            const finalDDXPriorVotesB = await derivadex.getPriorVotesDDXAsync(fixtures.traderB(), blockNumber);
            const finalDDXPriorVotesC = await derivadex.getPriorVotesDDXAsync(fixtures.traderC(), blockNumber);
            const finalDDXPriorVotesD = await derivadex.getPriorVotesDDXAsync(fixtures.traderD(), blockNumber);
            const finalDDXPriorVotesE = await derivadex.getPriorVotesDDXAsync(fixtures.traderE(), blockNumber);
            const finalDDXPriorVotesF = await derivadex.getPriorVotesDDXAsync(fixtures.traderF(), blockNumber);
            expect(finalDDXPriorVotesB).to.be.bignumber.eq(8000);
            expect(finalDDXPriorVotesC).to.be.bignumber.eq(0);
            expect(finalDDXPriorVotesD).to.be.bignumber.eq(7000);
            expect(finalDDXPriorVotesE).to.be.bignumber.eq(1500);
            expect(finalDDXPriorVotesF).to.be.bignumber.eq(500);

            const finalSupplyInfoDDX = await derivadex.getSupplyInfoDDXAsync();
            expect(finalSupplyInfoDDX.issuedSupply).to.be.bignumber.eq(50005000);
            expect(finalSupplyInfoDDX.totalSupply).to.be.bignumber.eq(50002000);
        });

        it('do some additional delegation downstream', async () => {
            await derivadex.delegateDDX(fixtures.traderF()).awaitTransactionSuccessAsync({ from: fixtures.traderD() });
            await derivadex.delegateDDX(fixtures.traderF()).awaitTransactionSuccessAsync({ from: fixtures.traderF() });

            const finalDDXCurrentVotesD = await derivadex.getCurrentVotesAsync(fixtures.traderD());
            expect(finalDDXCurrentVotesD).to.be.bignumber.eq(6500);

            await advanceBlocksAsync(derivadex.providerEngine, 1);
            const blockNumber = (await getBlockNumberAsync(derivadex.providerEngine)) - 1;

            const finalDDXPriorVotesD = await derivadex.getPriorVotesDDXAsync(fixtures.traderD(), blockNumber);
            const finalDDXPriorVotesF = await derivadex.getPriorVotesDDXAsync(fixtures.traderF(), blockNumber);
            expect(finalDDXPriorVotesD).to.be.bignumber.eq(6500);
            expect(finalDDXPriorVotesF).to.be.bignumber.eq(1000);
        });

        it('approves using permit', async () => {
            const preAllowance = await derivadex.getAllowanceDDXAsync(fixtures.traderB(), fixtures.traderF());
            expect(preAllowance).to.be.bignumber.eq(0);

            const expiry = await setExpiryAsync(derivadex.providerEngine, 100e9);
            const signatureForPermit = await derivadex.getSignatureForPermitAsync(
                fixtures.traderF(),
                1234,
                0,
                expiry,
                fixtures.traderB(),
            );
            await derivadex
                .permitDDX(fixtures.traderF(), 1234, 0, expiry, signatureForPermit)
                .awaitTransactionSuccessAsync({ from: fixtures.traderC() });
            const postAllowance = await derivadex.getAllowanceDDXAsync(fixtures.traderB(), fixtures.traderF());
            expect(postAllowance).to.be.bignumber.eq(1234);
        });
    });
});
