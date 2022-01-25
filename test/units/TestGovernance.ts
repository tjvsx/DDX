import { Web3Wrapper } from '@0x/web3-wrapper';
import { Derivadex } from '@derivadex/contract-wrappers';
import {
    advanceBlocksAsync,
    advanceTimeAsync,
    generateCallData,
    getBlockNumberAsync,
    getSelectors,
} from '@derivadex/dev-utils';
import { expect } from '@derivadex/test-utils';
import { FacetCutAction, ProposalState } from '@derivadex/types';
import { ethers } from 'ethers';
import * as hardhat from 'hardhat';

import { setupWithProviderAsync } from '../../deployment/setup';
import { Fixtures } from '../fixtures';

describe('#Governance', () => {
    let derivadex: Derivadex;
    let accounts: string[];
    let owner: string;
    let fixtures: Fixtures;

    describe('Governance Tests - #1', () => {
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
            const pauseSelectors = getSelectors(new ethers.utils.Interface(derivadex.pauseContract.abi));
            await derivadex
                .diamondCut(
                    [
                        {
                            facetAddress: derivadex.pauseContract.address,
                            action: FacetCutAction.Add,
                            functionSelectors: pauseSelectors,
                        },
                    ],
                    derivadex.pauseContract.address,
                    derivadex.initializePause().getABIEncodedTransactionData(),
                )
                .awaitTransactionSuccessAsync({ from: owner });
            derivadex.setPauseAddressToProxy();
        });

        it('fails to add Governance facet with invalid skipRemainingVotingThreshold below 50pct', async () => {
            const governanceSelectors = getSelectors(new ethers.utils.Interface(derivadex.governanceContract.abi));
            await expect(
                derivadex
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
                            .initializeGovernance(10, 1, 17280, 1209600, 259200, 4, 1, 49)
                            .getABIEncodedTransactionData(),
                    )
                    .awaitTransactionSuccessAsync({ from: owner }),
            ).to.be.rejectedWith('Governance: skip rem votes must be higher than 50pct.');
        });

        it('fails to add Governance facet with invalid skipRemainingVotingThreshold and quorumVotes', async () => {
            const governanceSelectors = getSelectors(new ethers.utils.Interface(derivadex.governanceContract.abi));
            await expect(
                derivadex
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
                            .initializeGovernance(10, 1, 17280, 1209600, 259200, 51, 1, 50)
                            .getABIEncodedTransactionData(),
                    )
                    .awaitTransactionSuccessAsync({ from: owner }),
            ).to.be.rejectedWith('Governance: skip rem votes must be higher than quorum.');
        });

        it('adds Governance facet', async () => {
            const governanceSelectors = getSelectors(new ethers.utils.Interface(derivadex.governanceContract.abi));
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

            const governanceParameters = await derivadex.getGovernanceParametersAsync();
            expect(governanceParameters.proposalMaxOperations).to.be.bignumber.eq(10);
            expect(governanceParameters.votingDelay).to.be.bignumber.eq(1);
            expect(governanceParameters.votingPeriod).to.be.bignumber.eq(17280);
            expect(governanceParameters.gracePeriod).to.be.bignumber.eq(1209600);
            expect(governanceParameters.timelockDelay).to.be.bignumber.eq(259200);
            expect(governanceParameters.quorumVotes).to.be.bignumber.eq(4);
            expect(governanceParameters.proposalThreshold).to.be.bignumber.eq(1);
            expect(governanceParameters.skipRemainingVotingThreshold).to.be.bignumber.eq(50);
        });

        it('transfer ownership of Proxy to itself', async () => {
            let admin = await derivadex.getAdminAsync();
            expect(admin).to.eq(owner);
            await derivadex.transferOwnershipToSelf().awaitTransactionSuccessAsync({ from: owner });
            admin = await derivadex.getAdminAsync();
            expect(admin).to.eq(derivadex.derivaDEXContract.address);
        });

        it('checks quorum vote count, proposer vote count, and skip remaining voting threshold count', async () => {
            const quorumVoteCount = await derivadex.getQuorumVoteCountAsync();
            expect(quorumVoteCount).to.be.bignumber.eq(2000000);
            const proposerThresholdCount = await derivadex.getProposerThresholdCountAsync();
            expect(proposerThresholdCount).to.be.bignumber.eq(500000);
            const skipRemainingVotingThresholdCountAsync = await derivadex.getSkipRemainingVotingThresholdCountAsync();
            expect(skipRemainingVotingThresholdCountAsync).to.be.bignumber.eq(25000000);
        });

        it('fails to propose when proposer not above threshold', async () => {
            const targets = [derivadex.derivaDEXContract.address];
            const values = [0];
            const signatures = [derivadex.governanceContract.getFunctionSignature('setQuorumVotes')];
            const calldatas = [generateCallData(derivadex.setQuorumVotes(5).getABIEncodedTransactionData())];
            const description = 'Set new quorum votes.';

            await expect(
                derivadex
                    .propose(targets, values, signatures, calldatas, description)
                    .awaitTransactionSuccessAsync({ from: fixtures.traderB() }),
            ).to.be.rejectedWith('Governance: proposer votes below proposal threshold.');
        });

        it('fails to propose when proposal parity misaligned', async () => {
            const targets = [derivadex.derivaDEXContract.address];
            const values = [0, 1];
            const signatures = [derivadex.governanceContract.getFunctionSignature('setQuorumVotes')];
            const calldatas = [generateCallData(derivadex.setQuorumVotes(5).getABIEncodedTransactionData())];
            const description = 'Set new quorum votes.';

            await expect(
                derivadex
                    .propose(targets, values, signatures, calldatas, description)
                    .awaitTransactionSuccessAsync({ from: fixtures.derivaDEXWallet() }),
            ).to.be.rejectedWith('Governance: proposal function information parity mismatch.');
        });

        it('fails to propose when proposal has no actions', async () => {
            const description = 'Set new quorum votes.';
            await expect(
                derivadex
                    .propose([], [], [], [], description)
                    .awaitTransactionSuccessAsync({ from: fixtures.derivaDEXWallet() }),
            ).to.be.rejectedWith('Governance: must provide actions.');
        });

        it('fails to propose when proposal has too many actions', async () => {
            const targets = [
                derivadex.derivaDEXContract.address,
                derivadex.derivaDEXContract.address,
                derivadex.derivaDEXContract.address,
                derivadex.derivaDEXContract.address,
                derivadex.derivaDEXContract.address,
                derivadex.derivaDEXContract.address,
                derivadex.derivaDEXContract.address,
                derivadex.derivaDEXContract.address,
                derivadex.derivaDEXContract.address,
                derivadex.derivaDEXContract.address,
                derivadex.derivaDEXContract.address,
            ];
            const values = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
            const signatures = [
                derivadex.governanceContract.getFunctionSignature('setQuorumVotes'),
                derivadex.governanceContract.getFunctionSignature('setQuorumVotes'),
                derivadex.governanceContract.getFunctionSignature('setQuorumVotes'),
                derivadex.governanceContract.getFunctionSignature('setQuorumVotes'),
                derivadex.governanceContract.getFunctionSignature('setQuorumVotes'),
                derivadex.governanceContract.getFunctionSignature('setQuorumVotes'),
                derivadex.governanceContract.getFunctionSignature('setQuorumVotes'),
                derivadex.governanceContract.getFunctionSignature('setQuorumVotes'),
                derivadex.governanceContract.getFunctionSignature('setQuorumVotes'),
                derivadex.governanceContract.getFunctionSignature('setQuorumVotes'),
                derivadex.governanceContract.getFunctionSignature('setQuorumVotes'),
            ];
            const calldatas = [
                generateCallData(derivadex.setQuorumVotes(5).getABIEncodedTransactionData()),
                generateCallData(derivadex.setQuorumVotes(5).getABIEncodedTransactionData()),
                generateCallData(derivadex.setQuorumVotes(5).getABIEncodedTransactionData()),
                generateCallData(derivadex.setQuorumVotes(5).getABIEncodedTransactionData()),
                generateCallData(derivadex.setQuorumVotes(5).getABIEncodedTransactionData()),
                generateCallData(derivadex.setQuorumVotes(5).getABIEncodedTransactionData()),
                generateCallData(derivadex.setQuorumVotes(5).getABIEncodedTransactionData()),
                generateCallData(derivadex.setQuorumVotes(5).getABIEncodedTransactionData()),
                generateCallData(derivadex.setQuorumVotes(5).getABIEncodedTransactionData()),
                generateCallData(derivadex.setQuorumVotes(5).getABIEncodedTransactionData()),
                generateCallData(derivadex.setQuorumVotes(5).getABIEncodedTransactionData()),
            ];
            const description = 'Set new quorum votes.';

            await expect(
                derivadex
                    .propose(targets, values, signatures, calldatas, description)
                    .awaitTransactionSuccessAsync({ from: fixtures.derivaDEXWallet() }),
            ).to.be.rejectedWith('Governance: too many actions.');
        });

        it('makes new proposal and fails to cast vote before voting delay', async () => {
            let proposalCount = await derivadex.getProposalCountAsync();
            expect(proposalCount).to.be.bignumber.eq(0);
            let latestProposalID = await derivadex.getLatestProposalIdAsync(fixtures.derivaDEXWallet());
            expect(latestProposalID).to.be.bignumber.eq(0);
            const targets = [derivadex.derivaDEXContract.address];
            const values = [0];
            const signatures = [derivadex.governanceContract.getFunctionSignature('setQuorumVotes')];
            const calldatas = [generateCallData(derivadex.setQuorumVotes(5).getABIEncodedTransactionData())];
            const description = 'Set new quorum votes.';

            await derivadex
                .propose(targets, values, signatures, calldatas, description)
                .awaitTransactionSuccessAsync({ from: fixtures.derivaDEXWallet() });
            await expect(
                derivadex.castVote(1, false).awaitTransactionSuccessAsync({ from: fixtures.traderB() }),
            ).to.be.rejectedWith('Governance: voting is closed.');
            const proposalStatus = await derivadex.getStateOfProposalAsync(1);
            expect(proposalStatus).to.eq(ProposalState.Pending);

            proposalCount = await derivadex.getProposalCountAsync();
            expect(proposalCount).to.be.bignumber.eq(1);
            latestProposalID = await derivadex.getLatestProposalIdAsync(fixtures.derivaDEXWallet());
            expect(latestProposalID).to.be.bignumber.eq(1);
        });

        it('fails to propose when proposer already has active proposal', async () => {
            await advanceBlocksAsync(derivadex.providerEngine, 2);
            const proposalStatus = await derivadex.getStateOfProposalAsync(1);
            expect(proposalStatus).to.eq(ProposalState.Active);
            const targets = [derivadex.derivaDEXContract.address];
            const values = [0];
            const signatures = [derivadex.governanceContract.getFunctionSignature('setProposalThreshold')];
            const calldatas = [generateCallData(derivadex.setProposalThreshold(2).getABIEncodedTransactionData())];
            const description = 'Set new proposal threshold.';

            await expect(
                derivadex
                    .propose(targets, values, signatures, calldatas, description)
                    .awaitTransactionSuccessAsync({ from: fixtures.derivaDEXWallet() }),
            ).to.be.rejectedWith('Governance: one live proposal per proposer, found an already active proposal.');
        });

        it('check vote receipts prior to voting for proposal 1', async () => {
            const traderBVoteReceipt = await derivadex.getReceiptAsync(1, fixtures.traderB());
            expect(traderBVoteReceipt.hasVoted).to.eq(false);
            expect(traderBVoteReceipt.support).to.eq(false);
            expect(traderBVoteReceipt.votes).to.be.bignumber.eq(0);

            const traderCVoteReceipt = await derivadex.getReceiptAsync(1, fixtures.traderC());
            expect(traderCVoteReceipt.hasVoted).to.eq(false);
            expect(traderCVoteReceipt.support).to.eq(false);
            expect(traderCVoteReceipt.votes).to.be.bignumber.eq(0);

            const traderDVoteReceipt = await derivadex.getReceiptAsync(1, fixtures.traderD());
            expect(traderDVoteReceipt.hasVoted).to.eq(false);
            expect(traderDVoteReceipt.support).to.eq(false);
            expect(traderDVoteReceipt.votes).to.be.bignumber.eq(0);

            const traderEVoteReceipt = await derivadex.getReceiptAsync(1, fixtures.traderE());
            expect(traderEVoteReceipt.hasVoted).to.eq(false);
            expect(traderEVoteReceipt.support).to.eq(false);
            expect(traderEVoteReceipt.votes).to.be.bignumber.eq(0);

            const derivaDEXWalletVoteReceipt = await derivadex.getReceiptAsync(1, fixtures.derivaDEXWallet());
            expect(derivaDEXWalletVoteReceipt.hasVoted).to.eq(false);
            expect(derivaDEXWalletVoteReceipt.support).to.eq(false);
            expect(derivaDEXWalletVoteReceipt.votes).to.be.bignumber.eq(0);
        });

        it('casts vote', async () => {
            await advanceBlocksAsync(derivadex.providerEngine, 2);
            await derivadex.castVote(1, true).awaitTransactionSuccessAsync({ from: fixtures.traderC() });

            const balanceOfTraderD = await derivadex.getBalanceOfDDXAsync(fixtures.traderD());
            expect(balanceOfTraderD).to.be.bignumber.eq(25000);
            const balanceOfTraderE = await derivadex.getBalanceOfDDXAsync(fixtures.traderE());
            expect(balanceOfTraderE).to.be.bignumber.eq(0);
            const blockNumber = (await getBlockNumberAsync(derivadex.providerEngine)) - 1;
            const priorVotesOfTraderD = await derivadex.getPriorVotesDDXAsync(fixtures.traderD(), blockNumber);
            expect(priorVotesOfTraderD).to.be.bignumber.eq(0);
            const priorVotesOfTraderE = await derivadex.getPriorVotesDDXAsync(fixtures.traderE(), blockNumber);
            expect(priorVotesOfTraderE).to.be.bignumber.eq(25000);
            const signatureVoteCast = await derivadex.getSignatureForVoteCastAsync(1, false, fixtures.traderE());
            await derivadex
                .castVoteBySigAsync(1, false, signatureVoteCast)
                .awaitTransactionSuccessAsync({ from: fixtures.traderF() });

            const traderCVoteReceipt = await derivadex.getReceiptAsync(1, fixtures.traderC());
            expect(traderCVoteReceipt.hasVoted).to.eq(true);
            expect(traderCVoteReceipt.support).to.eq(true);
            expect(traderCVoteReceipt.votes).to.be.bignumber.eq(5000);

            const traderDVoteReceipt = await derivadex.getReceiptAsync(1, fixtures.traderD());
            expect(traderDVoteReceipt.hasVoted).to.eq(false);
            expect(traderDVoteReceipt.support).to.eq(false);
            expect(traderDVoteReceipt.votes).to.be.bignumber.eq(0);

            const traderEVoteReceipt = await derivadex.getReceiptAsync(1, fixtures.traderE());
            expect(traderEVoteReceipt.hasVoted).to.eq(true);
            expect(traderEVoteReceipt.support).to.eq(false);
            expect(traderEVoteReceipt.votes).to.be.bignumber.eq(25000);

            const traderFVoteReceipt = await derivadex.getReceiptAsync(1, fixtures.traderF());
            expect(traderFVoteReceipt.hasVoted).to.eq(false);
            expect(traderFVoteReceipt.support).to.eq(false);
            expect(traderFVoteReceipt.votes).to.be.bignumber.eq(0);
        });

        it('fails to cast another vote after already voting', async () => {
            await expect(
                derivadex.castVote(1, true).awaitTransactionSuccessAsync({ from: fixtures.traderC() }),
            ).to.be.rejectedWith('Governance: voter already voted.');
        });

        it('fails to queue proposal since it has not succeeded yet', async () => {
            await expect(
                derivadex.queue(1).awaitTransactionSuccessAsync({ from: fixtures.traderB() }),
            ).to.be.rejectedWith('Governance: proposal can only be queued if it is succeeded.');
        });

        it('fails to cast a vote from participant with no voting power', async () => {
            await expect(
                derivadex.castVote(1, true).awaitTransactionSuccessAsync({ from: fixtures.traderF() }),
            ).to.be.rejectedWith('Governance: voter has no voting power.');
        });

        it('casts another vote', async () => {
            await derivadex.castVote(1, true).awaitTransactionSuccessAsync({ from: fixtures.derivaDEXWallet() });

            const traderDerivaDEXWalletVoteReceipt = await derivadex.getReceiptAsync(1, fixtures.derivaDEXWallet());
            expect(traderDerivaDEXWalletVoteReceipt.hasVoted).to.eq(true);
            expect(traderDerivaDEXWalletVoteReceipt.support).to.eq(true);
            expect(traderDerivaDEXWalletVoteReceipt.votes).to.be.bignumber.eq(49960000);
        });

        it('fails to execute proposal that is not queued', async () => {
            await expect(
                derivadex.execute(1).awaitTransactionSuccessAsync({ from: fixtures.derivaDEXWallet() }),
            ).to.be.rejectedWith('Governance: proposal can only be executed if it is queued.');
        });

        it('queues successful proposal since voting period can be skipped with enough for votes', async () => {
            await derivadex.queue(1).awaitTransactionSuccessAsync({ from: fixtures.traderB() });
        });

        it('fails to queue proposal again', async () => {
            await expect(
                derivadex.queue(1).awaitTransactionSuccessAsync({ from: fixtures.derivaDEXWallet() }),
            ).to.be.rejectedWith('Governance: proposal can only be queued if it is succeeded.');
        });

        it('fails to execute proposal that has not been in queue long enough', async () => {
            await expect(
                derivadex.execute(1).awaitTransactionSuccessAsync({ from: fixtures.derivaDEXWallet() }),
            ).to.be.rejectedWith("Governance: proposal hasn't finished queue time length.");
        });

        it('executes successful proposal', async () => {
            await advanceTimeAsync(derivadex.providerEngine, 259200);
            await advanceBlocksAsync(derivadex.providerEngine, 1);

            let governanceParameters = await derivadex.getGovernanceParametersAsync();
            expect(governanceParameters.quorumVotes).to.be.bignumber.eq(4);
            await derivadex.execute(1).awaitTransactionSuccessAsync({ from: fixtures.traderB() });
            governanceParameters = await derivadex.getGovernanceParametersAsync();
            expect(governanceParameters.quorumVotes).to.be.bignumber.eq(5);
            const proposalStatus = await derivadex.getStateOfProposalAsync(1);
            expect(proposalStatus).to.eq(ProposalState.Executed);
        });

        it('fails to set invalid skip remaining votes threshold', async () => {
            const targets = [derivadex.derivaDEXContract.address];
            const values = [0];
            const signatures = [derivadex.governanceContract.getFunctionSignature('setSkipRemainingVotingThreshold')];
            const calldatas = [
                generateCallData(derivadex.setSkipRemainingVotingThreshold(49).getABIEncodedTransactionData()),
            ];
            const description = 'Set new skip remaining vote threshold.';
            await derivadex
                .propose(targets, values, signatures, calldatas, description)
                .awaitTransactionSuccessAsync({ from: fixtures.derivaDEXWallet() });
            await advanceBlocksAsync(derivadex.providerEngine, 2);
            await derivadex.castVote(2, true).awaitTransactionSuccessAsync({ from: fixtures.derivaDEXWallet() });
            await derivadex.queue(2).awaitTransactionSuccessAsync({ from: fixtures.traderB() });
            await advanceTimeAsync(derivadex.providerEngine, 259200);
            await advanceBlocksAsync(derivadex.providerEngine, 1);
            await expect(
                derivadex.execute(2).awaitTransactionSuccessAsync({ from: fixtures.traderB() }),
            ).to.be.rejectedWith('Governance: transaction execution reverted.');
        });

        it('fails to set invalid quorum votes', async () => {
            const targets = [derivadex.derivaDEXContract.address];
            const values = [0];
            const signatures = [derivadex.governanceContract.getFunctionSignature('setQuorumVotes')];
            const calldatas = [generateCallData(derivadex.setQuorumVotes(50).getABIEncodedTransactionData())];
            const description = 'Set new quorum votes.';
            await derivadex
                .propose(targets, values, signatures, calldatas, description)
                .awaitTransactionSuccessAsync({ from: fixtures.derivaDEXWallet() });
            await advanceBlocksAsync(derivadex.providerEngine, 2);
            await derivadex.castVote(3, true).awaitTransactionSuccessAsync({ from: fixtures.derivaDEXWallet() });
            await derivadex.queue(3).awaitTransactionSuccessAsync({ from: fixtures.traderB() });
            await advanceTimeAsync(derivadex.providerEngine, 259200);
            await advanceBlocksAsync(derivadex.providerEngine, 1);
            await expect(
                derivadex.execute(3).awaitTransactionSuccessAsync({ from: fixtures.traderB() }),
            ).to.be.rejectedWith('Governance: transaction execution reverted.');
        });

        it('checks fastpath delay for setIsPaused', async () => {
            const targets = [derivadex.derivaDEXContract.address];
            const values = [0];
            const signatures = [derivadex.pauseContract.getFunctionSignature('setIsPaused')];
            const calldatas = [generateCallData(derivadex.setIsPaused(true).getABIEncodedTransactionData())];
            const description = 'Set isPaused to true.';

            await derivadex
                .propose(targets, values, signatures, calldatas, description)
                .awaitTransactionSuccessAsync({ from: fixtures.derivaDEXWallet() });

            const proposal = await derivadex.getProposalAsync(4);
            expect(proposal.delay).to.be.bignumber.eq(1);
            await advanceBlocksAsync(derivadex.providerEngine, 2);
            await derivadex.castVote(4, true).awaitTransactionSuccessAsync({ from: fixtures.derivaDEXWallet() });
            await derivadex.queue(4).awaitTransactionSuccessAsync({ from: fixtures.traderB() });
            await advanceTimeAsync(derivadex.providerEngine, 1);
            await advanceBlocksAsync(derivadex.providerEngine, 1);
            await derivadex.execute(4).awaitTransactionSuccessAsync({ from: fixtures.traderB() });
        });
    });
});
// tslint:disable-line:max-file-line-count
