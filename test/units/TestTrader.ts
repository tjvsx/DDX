import { Web3Wrapper } from '@0x/web3-wrapper';
import { DDXWalletCloneableContract, Derivadex } from '@derivadex/contract-wrappers';
import {
    advanceBlocksAsync,
    advanceTimeAsync,
    generateCallData,
    getBlockNumberAsync,
    getSelectors,
} from '@derivadex/dev-utils';
import { expect } from '@derivadex/test-utils';
import { FacetCutAction } from '@derivadex/types';
import { ethers } from 'ethers';
import * as hardhat from 'hardhat';

import { setupWithProviderAsync } from '../../deployment/setup';
import { Fixtures, ZERO_ADDRESS } from '../fixtures';

describe('#Trader', () => {
    let derivadex: Derivadex;
    let accounts: string[];
    let owner: string;
    let fixtures: Fixtures;

    describe('Trader Tests - #1', () => {
        before(async () => {
            // Reset the hardhat network provider to a fresh state.
            const provider = hardhat.network.provider;
            const web3Wrapper = new Web3Wrapper(provider);
            await web3Wrapper.sendRawPayloadAsync<void>({
                method: 'hardhat_reset',
                params: [],
            });

            ({ derivadex, accounts, owner } = await setupWithProviderAsync(provider, {
                isFork: false,
                isGanache: true,
                useDeployedDDXToken: false,
            }));
            fixtures = new Fixtures(derivadex, accounts, owner);

            await derivadex
                .transferOwnershipToDerivaDEXProxyDDX(derivadex.derivaDEXContract.address)
                .awaitTransactionSuccessAsync({ from: fixtures.derivaDEXWallet() });

            await derivadex
                .transferDDX(fixtures.traderB(), 10000)
                .awaitTransactionSuccessAsync({ from: fixtures.derivaDEXWallet() });
            await derivadex
                .transferDDX(fixtures.traderC(), 5000)
                .awaitTransactionSuccessAsync({ from: fixtures.derivaDEXWallet() });
            await derivadex
                .transferDDX(fixtures.traderD(), 25000)
                .awaitTransactionSuccessAsync({ from: fixtures.derivaDEXWallet() });

            await derivadex.ddxContract
                .delegate(fixtures.traderE())
                .awaitTransactionSuccessAsync({ from: fixtures.traderD() });
            await advanceBlocksAsync(derivadex.providerEngine, 1);

            const governanceSelectors = getSelectors(new ethers.utils.Interface(derivadex.governanceContract.abi), [
                'initialize',
            ]);
            await derivadex
                .diamondCut(
                    [
                        {
                            facetAddress: derivadex.governanceContract.address,
                            action: FacetCutAction.Add,
                            functionSelectors: governanceSelectors,
                        },
                    ],
                    derivadex.governanceContract.address,
                    derivadex
                        .initializeGovernance(10, 1, 17280, 1209600, 259200, 4, 1, 50)
                        .getABIEncodedTransactionData(),
                )
                .awaitTransactionSuccessAsync({ from: owner });
            derivadex.setGovernanceAddressToProxy();

            await derivadex.transferOwnershipToSelf().awaitTransactionSuccessAsync({ from: owner });
        });

        it('adds Trader facet', async () => {
            const selectors = getSelectors(new ethers.utils.Interface(derivadex.traderContract.abi), ['initialize']);

            const targets = [derivadex.derivaDEXContract.address];
            const values = [0];
            const signatures = [derivadex.diamondFacetContract.getFunctionSignature('diamondCut')];
            const calldatas = [
                generateCallData(
                    derivadex
                        .diamondCut(
                            [
                                {
                                    facetAddress: derivadex.traderContract.address,
                                    action: FacetCutAction.Add,
                                    functionSelectors: selectors,
                                },
                            ],
                            derivadex.traderContract.address,
                            derivadex
                                .initializeTrader(derivadex.ddxWalletCloneableContract.address)
                                .getABIEncodedTransactionData(),
                        )
                        .getABIEncodedTransactionData(),
                ),
            ];
            const description = 'Add Trader contract as a facet.';

            await derivadex
                .propose(targets, values, signatures, calldatas, description)
                .awaitTransactionSuccessAsync({ from: fixtures.derivaDEXWallet() });
            await advanceBlocksAsync(derivadex.providerEngine, 2);

            await derivadex.castVote(1, true).awaitTransactionSuccessAsync({ from: fixtures.derivaDEXWallet() });

            await derivadex.queue(1).awaitTransactionSuccessAsync({ from: fixtures.traderB() });

            await advanceTimeAsync(derivadex.providerEngine, 259200);
            await advanceBlocksAsync(derivadex.providerEngine, 1);

            await derivadex.execute(1).awaitTransactionSuccessAsync({ from: fixtures.traderB() });

            derivadex.setTraderAddressToProxy();
        });

        it('stakes DDX properly', async () => {
            let traderBAttributes = await derivadex.getTraderAsync(fixtures.traderB());
            let traderCAttributes = await derivadex.getTraderAsync(fixtures.traderC());
            let traderDAttributes = await derivadex.getTraderAsync(fixtures.traderD());
            expect(traderBAttributes.ddxBalance).to.be.bignumber.eq(0);
            expect(traderBAttributes.ddxWalletContract).to.eq(ZERO_ADDRESS);
            expect(traderCAttributes.ddxBalance).to.be.bignumber.eq(0);
            expect(traderCAttributes.ddxWalletContract).to.eq(ZERO_ADDRESS);
            expect(traderDAttributes.ddxBalance).to.be.bignumber.eq(0);
            expect(traderDAttributes.ddxWalletContract).to.eq(ZERO_ADDRESS);

            let derivaDEXProxyBalance = await derivadex.getBalanceOfDDXAsync(derivadex.derivaDEXContract.address);
            const derivaDEXWalletBalance = await derivadex.getBalanceOfDDXAsync(fixtures.derivaDEXWallet());
            let traderBBalance = await derivadex.getBalanceOfDDXAsync(fixtures.traderB());
            let traderCBalance = await derivadex.getBalanceOfDDXAsync(fixtures.traderC());
            let traderDBalance = await derivadex.getBalanceOfDDXAsync(fixtures.traderD());
            let traderEBalance = await derivadex.getBalanceOfDDXAsync(fixtures.traderE());
            expect(derivaDEXProxyBalance).to.be.bignumber.eq(0);
            expect(derivaDEXWalletBalance).to.be.bignumber.eq(49960000);
            expect(traderBBalance).to.be.bignumber.eq(10000);
            expect(traderCBalance).to.be.bignumber.eq(5000);
            expect(traderDBalance).to.be.bignumber.eq(25000);
            expect(traderEBalance).to.be.bignumber.eq(0);

            let blockNumber = (await getBlockNumberAsync(derivadex.providerEngine)) - 1;
            let derivaDEXWalletPriorVotes = await derivadex.getPriorVotesDDXAsync(
                fixtures.derivaDEXWallet(),
                blockNumber,
            );
            let traderBPriorVotes = await derivadex.getPriorVotesDDXAsync(fixtures.traderB(), blockNumber);
            let traderCPriorVotes = await derivadex.getPriorVotesDDXAsync(fixtures.traderC(), blockNumber);
            let traderDPriorVotes = await derivadex.getPriorVotesDDXAsync(fixtures.traderD(), blockNumber);
            let traderEPriorVotes = await derivadex.getPriorVotesDDXAsync(fixtures.traderE(), blockNumber);
            expect(derivaDEXWalletPriorVotes).to.be.bignumber.eq(49960000);
            expect(traderBPriorVotes).to.be.bignumber.eq(10000);
            expect(traderCPriorVotes).to.be.bignumber.eq(5000);
            expect(traderDPriorVotes).to.be.bignumber.eq(0);
            expect(traderEPriorVotes).to.be.bignumber.eq(25000);

            await derivadex
                .approveUnlimitedDDX(derivadex.derivaDEXContract.address)
                .awaitTransactionSuccessAsync({ from: fixtures.traderB() });
            await derivadex.stakeDDXFromTrader(2000).awaitTransactionSuccessAsync({ from: fixtures.traderB() });
            await derivadex
                .approveUnlimitedDDX(derivadex.derivaDEXContract.address)
                .awaitTransactionSuccessAsync({ from: fixtures.traderC() });
            await derivadex
                .sendDDXFromTraderToTraderWallet(fixtures.traderB(), 100)
                .awaitTransactionSuccessAsync({ from: fixtures.traderC() });
            await derivadex.stakeDDXFromTrader(3000).awaitTransactionSuccessAsync({ from: fixtures.traderC() });
            await derivadex
                .approveUnlimitedDDX(derivadex.derivaDEXContract.address)
                .awaitTransactionSuccessAsync({ from: fixtures.traderD() });
            await derivadex.stakeDDXFromTrader(10000).awaitTransactionSuccessAsync({ from: fixtures.traderD() });
            await advanceBlocksAsync(derivadex.providerEngine, 1);

            traderBAttributes = await derivadex.getTraderAsync(fixtures.traderB());
            traderCAttributes = await derivadex.getTraderAsync(fixtures.traderC());
            traderDAttributes = await derivadex.getTraderAsync(fixtures.traderD());
            expect(traderBAttributes.ddxBalance).to.be.bignumber.eq(2100);
            expect(traderBAttributes.ddxWalletContract).to.not.eq(ZERO_ADDRESS);
            expect(traderCAttributes.ddxBalance).to.be.bignumber.eq(3000);
            expect(traderCAttributes.ddxWalletContract).to.not.eq(ZERO_ADDRESS);
            expect(traderDAttributes.ddxBalance).to.be.bignumber.eq(10000);
            expect(traderDAttributes.ddxWalletContract).to.not.eq(ZERO_ADDRESS);

            derivaDEXProxyBalance = await derivadex.getBalanceOfDDXAsync(derivadex.derivaDEXContract.address);
            traderBBalance = await derivadex.getBalanceOfDDXAsync(fixtures.traderB());
            traderCBalance = await derivadex.getBalanceOfDDXAsync(fixtures.traderC());
            traderDBalance = await derivadex.getBalanceOfDDXAsync(fixtures.traderD());
            traderEBalance = await derivadex.getBalanceOfDDXAsync(fixtures.traderE());
            const ddxWalletBBalance = await derivadex.getBalanceOfDDXAsync(traderBAttributes.ddxWalletContract);
            const ddxWalletCBalance = await derivadex.getBalanceOfDDXAsync(traderCAttributes.ddxWalletContract);
            const ddxWalletDDBalance = await derivadex.getBalanceOfDDXAsync(traderDAttributes.ddxWalletContract);
            expect(derivaDEXProxyBalance).to.be.bignumber.eq(0);
            expect(traderBBalance).to.be.bignumber.eq(8000);
            expect(traderCBalance).to.be.bignumber.eq(1900);
            expect(traderDBalance).to.be.bignumber.eq(15000);
            expect(traderEBalance).to.be.bignumber.eq(0);
            expect(ddxWalletBBalance).to.be.bignumber.eq(2100);
            expect(ddxWalletCBalance).to.be.bignumber.eq(3000);
            expect(ddxWalletDDBalance).to.be.bignumber.eq(10000);

            blockNumber = (await getBlockNumberAsync(derivadex.providerEngine)) - 1;
            derivaDEXWalletPriorVotes = await derivadex.getPriorVotesDDXAsync(fixtures.derivaDEXWallet(), blockNumber);
            traderBPriorVotes = await derivadex.getPriorVotesDDXAsync(fixtures.traderB(), blockNumber);
            traderCPriorVotes = await derivadex.getPriorVotesDDXAsync(fixtures.traderC(), blockNumber);
            traderDPriorVotes = await derivadex.getPriorVotesDDXAsync(fixtures.traderD(), blockNumber);
            traderEPriorVotes = await derivadex.getPriorVotesDDXAsync(fixtures.traderE(), blockNumber);
            const ddxWalletBPriorVotes = await derivadex.getPriorVotesDDXAsync(
                traderBAttributes.ddxWalletContract,
                blockNumber,
            );
            const ddxWalletCPriorVotes = await derivadex.getPriorVotesDDXAsync(
                traderCAttributes.ddxWalletContract,
                blockNumber,
            );
            const ddxWalletDPriorVotes = await derivadex.getPriorVotesDDXAsync(
                traderDAttributes.ddxWalletContract,
                blockNumber,
            );
            expect(derivaDEXWalletPriorVotes).to.be.bignumber.eq(49960000);
            expect(traderBPriorVotes).to.be.bignumber.eq(10100);
            expect(traderCPriorVotes).to.be.bignumber.eq(4900);
            expect(traderDPriorVotes).to.be.bignumber.eq(10000);
            expect(traderEPriorVotes).to.be.bignumber.eq(15000);
            expect(ddxWalletBPriorVotes).to.be.bignumber.eq(0);
            expect(ddxWalletCPriorVotes).to.be.bignumber.eq(0);
            expect(ddxWalletDPriorVotes).to.be.bignumber.eq(0);
        });

        it('fails to maliciously reinitialize onchain DDX wallet', async () => {
            const traderBAttributes = await derivadex.getTraderAsync(fixtures.traderB());
            const ddxWalletCloneableContract = new DDXWalletCloneableContract(
                traderBAttributes.ddxWalletContract,
                derivadex.providerEngine,
            );
            await expect(
                ddxWalletCloneableContract
                    .initialize(fixtures.traderF(), derivadex.ddxContract.address, fixtures.traderF())
                    .awaitTransactionSuccessAsync({ from: fixtures.traderF() }),
            ).to.be.rejectedWith('DDXWalletCloneable: already init.');
        });

        it('lifts governance cliff', async () => {
            const targets = [derivadex.derivaDEXContract.address];
            const values = [0];
            const signatures = [derivadex.traderContract.getFunctionSignature('setRewardCliff')];
            const calldatas = [generateCallData(derivadex.setRewardCliff(true).getABIEncodedTransactionData())];
            const description = 'Lifting reward cliff.';
            await derivadex
                .propose(targets, values, signatures, calldatas, description)
                .awaitTransactionSuccessAsync({ from: fixtures.derivaDEXWallet() });
            await advanceBlocksAsync(derivadex.providerEngine, 2);
            await derivadex.castVote(2, true).awaitTransactionSuccessAsync({ from: fixtures.derivaDEXWallet() });
            await derivadex.queue(2).awaitTransactionSuccessAsync({ from: fixtures.traderB() });
            await advanceTimeAsync(derivadex.providerEngine, 259200);
            await advanceBlocksAsync(derivadex.providerEngine, 1);
            await derivadex.execute(2).awaitTransactionSuccessAsync({ from: fixtures.traderB() });
        });

        it('withdraws DDX properly', async () => {
            await derivadex.withdrawDDXToTrader(1000).awaitTransactionSuccessAsync({ from: fixtures.traderB() });
            await derivadex.withdrawDDXToTrader(2000).awaitTransactionSuccessAsync({ from: fixtures.traderC() });
            await derivadex.withdrawDDXToTrader(5000).awaitTransactionSuccessAsync({ from: fixtures.traderD() });
            await advanceBlocksAsync(derivadex.providerEngine, 1);

            const traderBAttributes = await derivadex.getTraderAsync(fixtures.traderB());
            const traderCAttributes = await derivadex.getTraderAsync(fixtures.traderC());
            const traderDAttributes = await derivadex.getTraderAsync(fixtures.traderD());
            expect(traderBAttributes.ddxBalance).to.be.bignumber.eq(1100);
            expect(traderBAttributes.ddxWalletContract).to.not.eq(ZERO_ADDRESS);
            expect(traderCAttributes.ddxBalance).to.be.bignumber.eq(1000);
            expect(traderCAttributes.ddxWalletContract).to.not.eq(ZERO_ADDRESS);
            expect(traderDAttributes.ddxBalance).to.be.bignumber.eq(5000);
            expect(traderDAttributes.ddxWalletContract).to.not.eq(ZERO_ADDRESS);

            const derivaDEXProxyBalance = await derivadex.getBalanceOfDDXAsync(derivadex.derivaDEXContract.address);
            const traderBBalance = await derivadex.getBalanceOfDDXAsync(fixtures.traderB());
            const traderCBalance = await derivadex.getBalanceOfDDXAsync(fixtures.traderC());
            const traderDBalance = await derivadex.getBalanceOfDDXAsync(fixtures.traderD());
            const traderEBalance = await derivadex.getBalanceOfDDXAsync(fixtures.traderE());
            const ddxWalletBBalance = await derivadex.getBalanceOfDDXAsync(traderBAttributes.ddxWalletContract);
            const ddxWalletCBalance = await derivadex.getBalanceOfDDXAsync(traderCAttributes.ddxWalletContract);
            const ddxWalletDDBalance = await derivadex.getBalanceOfDDXAsync(traderDAttributes.ddxWalletContract);
            expect(derivaDEXProxyBalance).to.be.bignumber.eq(0);
            expect(traderBBalance).to.be.bignumber.eq(9000);
            expect(traderCBalance).to.be.bignumber.eq(3900);
            expect(traderDBalance).to.be.bignumber.eq(20000);
            expect(traderEBalance).to.be.bignumber.eq(0);
            expect(ddxWalletBBalance).to.be.bignumber.eq(1100);
            expect(ddxWalletCBalance).to.be.bignumber.eq(1000);
            expect(ddxWalletDDBalance).to.be.bignumber.eq(5000);

            const blockNumber = (await getBlockNumberAsync(derivadex.providerEngine)) - 1;
            const derivaDEXWalletPriorVotes = await derivadex.getPriorVotesDDXAsync(
                fixtures.derivaDEXWallet(),
                blockNumber,
            );
            const traderBPriorVotes = await derivadex.getPriorVotesDDXAsync(fixtures.traderB(), blockNumber);
            const traderCPriorVotes = await derivadex.getPriorVotesDDXAsync(fixtures.traderC(), blockNumber);
            const traderDPriorVotes = await derivadex.getPriorVotesDDXAsync(fixtures.traderD(), blockNumber);
            const traderEPriorVotes = await derivadex.getPriorVotesDDXAsync(fixtures.traderE(), blockNumber);
            const ddxWalletBPriorVotes = await derivadex.getPriorVotesDDXAsync(
                traderBAttributes.ddxWalletContract,
                blockNumber,
            );
            const ddxWalletCPriorVotes = await derivadex.getPriorVotesDDXAsync(
                traderCAttributes.ddxWalletContract,
                blockNumber,
            );
            const ddxWalletDPriorVotes = await derivadex.getPriorVotesDDXAsync(
                traderDAttributes.ddxWalletContract,
                blockNumber,
            );
            expect(derivaDEXWalletPriorVotes).to.be.bignumber.eq(49960000);
            expect(traderBPriorVotes).to.be.bignumber.eq(10100);
            expect(traderCPriorVotes).to.be.bignumber.eq(4900);
            expect(traderDPriorVotes).to.be.bignumber.eq(5000);
            expect(traderEPriorVotes).to.be.bignumber.eq(20000);
            expect(ddxWalletBPriorVotes).to.be.bignumber.eq(0);
            expect(ddxWalletCPriorVotes).to.be.bignumber.eq(0);
            expect(ddxWalletDPriorVotes).to.be.bignumber.eq(0);
        });
    });
});
