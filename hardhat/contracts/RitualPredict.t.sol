// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {RitualPredict} from "./RitualPredict.sol";
import {
    MockScheduler,
    MockRitualWallet,
    MockTEERegistry,
    MockHTTPPrecompile,
    MockJQPrecompile
} from "./mocks/RitualMocks.sol";


contract ReentrantWinner {
    RitualPredict public immutable target;
    uint256 public marketId;
    bool public reentryAttempted;
    bool public reentrySucceeded;

    constructor(RitualPredict target_) {
        target = target_;
    }

    function placeBet(uint256 marketId_) external payable {
        marketId = marketId_;
        target.bet{value: msg.value}(marketId_, true);
    }

    function claim() external {
        target.claimWinnings(marketId);
    }

    receive() external payable {
        if (reentryAttempted) return;
        reentryAttempted = true;
        (reentrySucceeded, ) = address(target).call(
            abi.encodeWithSelector(target.claimWinnings.selector, marketId)
        );
    }
}

contract RitualPredictTest is Test {
    address internal constant SCHEDULER = 0x56e776BAE2DD60664b69Bd5F865F1180ffB7D58B;
    address internal constant RITUAL_WALLET = 0x532F0dF0896F353d8C3DD8cc134e8129DA2a3948;
    address internal constant TEE_REGISTRY = 0x9644e8562cE0Fe12b4deeC4163c064A8862Bf47F;
    address internal constant HTTP_PRECOMPILE = 0x0000000000000000000000000000000000000801;
    address internal constant JQ_PRECOMPILE = 0x0000000000000000000000000000000000000803;

    address internal constant ALICE = address(0xA11CE);
    address internal constant BOB = address(0xB0B);
    address internal constant EXECUTOR = address(0xE11E);

    RitualPredict internal predict;
    MockScheduler internal scheduler;
    MockRitualWallet internal ritualWallet;
    MockTEERegistry internal teeRegistry;
    MockHTTPPrecompile internal http;
    MockJQPrecompile internal jq;

    function setUp() public {
        _etch(address(new MockScheduler()), SCHEDULER);
        _etch(address(new MockRitualWallet()), RITUAL_WALLET);
        _etch(address(new MockTEERegistry()), TEE_REGISTRY);
        _etch(address(new MockHTTPPrecompile()), HTTP_PRECOMPILE);
        _etch(address(new MockJQPrecompile()), JQ_PRECOMPILE);

        scheduler = MockScheduler(SCHEDULER);
        ritualWallet = MockRitualWallet(RITUAL_WALLET);
        teeRegistry = MockTEERegistry(TEE_REGISTRY);
        http = MockHTTPPrecompile(HTTP_PRECOMPILE);
        jq = MockJQPrecompile(JQ_PRECOMPILE);

        teeRegistry.setExecutor(EXECUTOR, true);
        http.setResponse(200, bytes('{"price":4100}'), "");
        jq.setValue(4100);

        predict = new RitualPredict(1000); // one local block represents one human second
        vm.deal(ALICE, 100 ether);
        vm.deal(BOB, 100 ether);
    }

    function testCreateMarketStoresImmutableRuleAndBooksSchedulerRetries() public {
        uint256 marketId = _createMarket(RitualPredict.Comparator.GTE, 4000);
        RitualPredict.Market memory market = predict.getMarket(marketId);

        assertEq(market.id, 1);
        assertEq(market.creator, address(this));
        assertEq(market.question, "Will ETH clear the target?");
        assertEq(market.oracleUrl, "https://oracle.example/eth");
        assertEq(market.jsonPath, ".price");
        assertEq(market.target, 4000);
        assertEq(uint256(market.comparator), uint256(RitualPredict.Comparator.GTE));
        assertEq(market.closeBlock, block.number + 30);
        assertEq(market.resolveBlock, block.number + 45);
        assertEq(market.scheduleId, 1);

        (
            address target,
            uint32 startBlock,
            uint32 numCalls,
            uint32 frequency,
            uint32 ttl,
            uint256 maxFeePerGas,
            uint256 maxPriorityFeePerGas,
            address payer,
            bool cancelled
        ) = scheduler.scheduledCall(market.scheduleId);

        assertEq(target, address(predict));
        assertEq(startBlock, market.resolveBlock);
        assertEq(numCalls, predict.MAX_ATTEMPTS());
        assertEq(frequency, predict.RETRY_INTERVAL_BLOCKS());
        assertEq(ttl, predict.SCHEDULER_TTL_BLOCKS());
        assertEq(maxFeePerGas, predict.MAX_FEE_PER_GAS());
        assertEq(maxPriorityFeePerGas, predict.MIN_PRIORITY_FEE_PER_GAS());
        assertEq(payer, address(predict));
        assertFalse(cancelled);
    }

    function testCreateMarketRejectsEmptyRuleAndBadDuration() public {
        RitualPredict.NewMarket memory emptyQuestion = _params(RitualPredict.Comparator.GTE, 4000);
        emptyQuestion.question = "";
        vm.expectRevert(RitualPredict.EmptyString.selector);
        predict.createMarket(emptyQuestion);

        RitualPredict.NewMarket memory tooShort = _params(RitualPredict.Comparator.GTE, 4000);
        tooShort.bettingSeconds = 29;
        vm.expectRevert(RitualPredict.BadDuration.selector);
        predict.createMarket(tooShort);
    }

    function testBettingUsesBlockDeadlineInsteadOfTimestamp() public {
        uint256 marketId = _createMarket(RitualPredict.Comparator.GTE, 4000);
        RitualPredict.Market memory market = predict.getMarket(marketId);

        vm.warp(block.timestamp + 30 days);
        vm.prank(ALICE);
        predict.bet{value: 1 ether}(marketId, true);

        vm.roll(market.closeBlock);
        vm.prank(BOB);
        vm.expectRevert(RitualPredict.BettingClosed.selector);
        predict.bet{value: 1 ether}(marketId, false);

        assertEq(uint256(predict.getMarket(marketId).state), uint256(RitualPredict.MarketState.Closed));
    }

    function testOnlySchedulerCanResolve() public {
        uint256 marketId = _createMarket(RitualPredict.Comparator.GTE, 4000);
        vm.expectRevert(RitualPredict.OnlyScheduler.selector);
        predict.onScheduledResolve(0, marketId);
    }

    function testSuccessfulOracleResolutionPaysWinnerAndCancelsRetries() public {
        uint256 marketId = _createMarket(RitualPredict.Comparator.GTE, 4000);
        _bet(marketId, ALICE, true, 2 ether);
        _bet(marketId, BOB, false, 1 ether);

        RitualPredict.Market memory beforeResolve = predict.getMarket(marketId);
        vm.roll(beforeResolve.resolveBlock);
        scheduler.execute(address(predict), 0, marketId);

        RitualPredict.Market memory market = predict.getMarket(marketId);
        assertEq(uint256(market.state), uint256(RitualPredict.MarketState.Resolved));
        assertEq(uint256(market.outcome), uint256(RitualPredict.Outcome.Yes));
        assertEq(market.observedValue, 4100);
        assertEq(market.attempts, 1);
        assertEq(address(predict).balance, 3 ether);

        (, , , , , , , , bool cancelled) = scheduler.scheduledCall(market.scheduleId);
        assertTrue(cancelled);

        (, , , uint256 claimable) = predict.stakesOf(marketId, ALICE);
        assertEq(claimable, 3 ether);

        uint256 aliceBefore = ALICE.balance;
        vm.prank(ALICE);
        predict.claimWinnings(marketId);
        assertEq(ALICE.balance - aliceBefore, 3 ether);
        assertEq(address(predict).balance, 0);

        vm.prank(ALICE);
        vm.expectRevert(RitualPredict.AlreadySettled.selector);
        predict.claimWinnings(marketId);
    }

    function testOracleFailureRetriesThenInvalidatesAndRefunds() public {
        uint256 marketId = _createMarket(RitualPredict.Comparator.GTE, 4000);
        _bet(marketId, ALICE, true, 2 ether);
        _bet(marketId, BOB, false, 1 ether);
        http.setResponse(503, bytes("unavailable"), "");

        for (uint256 i = 0; i < predict.MAX_ATTEMPTS(); i++) {
            scheduler.execute(address(predict), i, marketId);
        }

        RitualPredict.Market memory market = predict.getMarket(marketId);
        assertEq(uint256(market.state), uint256(RitualPredict.MarketState.Invalid));
        assertEq(market.attempts, predict.MAX_ATTEMPTS());
        assertEq(market.invalidReason, "HTTP status is not 200");

        uint256 aliceBefore = ALICE.balance;
        vm.prank(ALICE);
        predict.claimRefund(marketId);
        assertEq(ALICE.balance - aliceBefore, 2 ether);

        uint256 bobBefore = BOB.balance;
        vm.prank(BOB);
        predict.claimRefund(marketId);
        assertEq(BOB.balance - bobBefore, 1 ether);
        assertEq(address(predict).balance, 0);
    }

    function testMalformedAsyncEnvelopeCountsAsFailureWithoutRevertingAttempt() public {
        uint256 marketId = _createMarket(RitualPredict.Comparator.GTE, 4000);
        _bet(marketId, ALICE, true, 1 ether);
        http.setMalformed(true);

        scheduler.execute(address(predict), 0, marketId);

        RitualPredict.Market memory market = predict.getMarket(marketId);
        assertEq(uint256(market.state), uint256(RitualPredict.MarketState.Resolving));
        assertEq(market.attempts, 1);
    }

    function testEmptyJqOutputCountsAsFailure() public {
        uint256 marketId = _createMarket(RitualPredict.Comparator.GTE, 4000);
        _bet(marketId, ALICE, true, 1 ether);
        jq.setEmptyOutput(true);

        scheduler.execute(address(predict), 0, marketId);

        RitualPredict.Market memory market = predict.getMarket(marketId);
        assertEq(uint256(market.state), uint256(RitualPredict.MarketState.Resolving));
        assertEq(market.attempts, 1);
    }

    function testMissingExecutorConsumesRetryButDoesNotMisresolveMarket() public {
        uint256 marketId = _createMarket(RitualPredict.Comparator.GTE, 4000);
        _bet(marketId, ALICE, true, 1 ether);
        teeRegistry.setExecutor(address(0), false);

        scheduler.execute(address(predict), 0, marketId);

        RitualPredict.Market memory market = predict.getMarket(marketId);
        assertEq(uint256(market.state), uint256(RitualPredict.MarketState.Resolving));
        assertEq(uint256(market.outcome), uint256(RitualPredict.Outcome.Unresolved));
        assertEq(market.attempts, 1);
    }

    function testDuplicateSchedulerReplayIsIdempotent() public {
        uint256 marketId = _createMarket(RitualPredict.Comparator.GTE, 4000);
        _bet(marketId, ALICE, true, 1 ether);
        http.setResponse(500, bytes("bad"), "");

        scheduler.execute(address(predict), 0, marketId);
        scheduler.execute(address(predict), 0, marketId);

        RitualPredict.Market memory market = predict.getMarket(marketId);
        assertEq(market.attempts, 1);
        assertEq(uint256(market.state), uint256(RitualPredict.MarketState.Resolving));
    }

    function testEmptyWinningSideInvalidatesInsteadOfDividingByZero() public {
        uint256 marketId = _createMarket(RitualPredict.Comparator.GTE, 4000);
        _bet(marketId, BOB, false, 1 ether);

        scheduler.execute(address(predict), 0, marketId);

        RitualPredict.Market memory market = predict.getMarket(marketId);
        assertEq(uint256(market.outcome), uint256(RitualPredict.Outcome.Yes));
        assertEq(uint256(market.state), uint256(RitualPredict.MarketState.Invalid));
        assertEq(market.invalidReason, "winning side has no stake");

        vm.prank(BOB);
        predict.claimRefund(marketId);
        assertEq(address(predict).balance, 0);
    }

    function testClaimMarksSettlementBeforeExternalTransferToBlockReentrancy() public {
        uint256 marketId = _createMarket(RitualPredict.Comparator.GTE, 4000);
        ReentrantWinner winner = new ReentrantWinner(predict);
        vm.deal(address(winner), 1 ether);
        winner.placeBet{value: 1 ether}(marketId);
        _bet(marketId, BOB, false, 1 ether);

        scheduler.execute(address(predict), 0, marketId);
        winner.claim();

        assertTrue(winner.reentryAttempted());
        assertFalse(winner.reentrySucceeded());
        (, , bool alreadySettled, uint256 claimable) = predict.stakesOf(marketId, address(winner));
        assertTrue(alreadySettled);
        assertEq(claimable, 0);
        assertEq(address(predict).balance, 0);
    }

    function testFundExecutionCreditsContractRitualWalletBalance() public {
        predict.fundExecution{value: 0.5 ether}(1000);
        assertEq(predict.executionBalance(), 0.5 ether);
        assertEq(ritualWallet.balanceOf(address(predict)), 0.5 ether);
    }

    function testPermissionlessRescueCannotRunBeforeAllRetriesAndTtlExpire() public {
        uint256 marketId = _createMarket(RitualPredict.Comparator.GTE, 4000);
        uint256 rescueAt = predict.resolutionDeadline(marketId);

        vm.roll(rescueAt);
        vm.expectRevert(abi.encodeWithSelector(RitualPredict.RescueTooEarly.selector, rescueAt));
        predict.rescueExpiredMarket(marketId);
    }

    function testPermissionlessRescueUnlocksRefundWhenSchedulerNeverRuns() public {
        uint256 marketId = _createMarket(RitualPredict.Comparator.GTE, 4000);
        _bet(marketId, ALICE, true, 2 ether);
        _bet(marketId, BOB, false, 1 ether);

        uint256 rescueAt = predict.resolutionDeadline(marketId);
        vm.roll(rescueAt + 1);

        vm.prank(address(0xCAFE));
        predict.rescueExpiredMarket(marketId);

        RitualPredict.Market memory market = predict.getMarket(marketId);
        assertEq(uint256(market.state), uint256(RitualPredict.MarketState.Invalid));
        assertEq(market.attempts, 0);
        assertEq(market.invalidReason, "resolution window expired");

        (, , , , , , , , bool cancelled) = scheduler.scheduledCall(market.scheduleId);
        assertTrue(cancelled);

        vm.prank(ALICE);
        predict.claimRefund(marketId);
        vm.prank(BOB);
        predict.claimRefund(marketId);
        assertEq(address(predict).balance, 0);
    }

    function testRescueCannotOverwriteResolvedOutcome() public {
        uint256 marketId = _createMarket(RitualPredict.Comparator.GTE, 4000);
        _bet(marketId, ALICE, true, 1 ether);
        scheduler.execute(address(predict), 0, marketId);

        vm.roll(predict.resolutionDeadline(marketId) + 1);
        vm.expectRevert(RitualPredict.MarketFinalized.selector);
        predict.rescueExpiredMarket(marketId);

        RitualPredict.Market memory market = predict.getMarket(marketId);
        assertEq(uint256(market.state), uint256(RitualPredict.MarketState.Resolved));
        assertEq(uint256(market.outcome), uint256(RitualPredict.Outcome.Yes));
    }

    function _createMarket(
        RitualPredict.Comparator comparator,
        uint256 target
    ) internal returns (uint256) {
        return predict.createMarket(_params(comparator, target));
    }

    function _params(
        RitualPredict.Comparator comparator,
        uint256 target
    ) internal pure returns (RitualPredict.NewMarket memory) {
        return
            RitualPredict.NewMarket({
                question: "Will ETH clear the target?",
                oracleUrl: "https://oracle.example/eth",
                jsonPath: ".price",
                target: target,
                comparator: comparator,
                bettingSeconds: 30,
                resolveDelaySeconds: 15
            });
    }

    function _bet(
        uint256 marketId,
        address bettor,
        bool isYes,
        uint256 amount
    ) internal {
        vm.prank(bettor);
        predict.bet{value: amount}(marketId, isYes);
    }

    function _etch(address implementation, address target) internal {
        vm.etch(target, implementation.code);
    }
}
