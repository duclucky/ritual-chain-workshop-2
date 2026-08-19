// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// Minimal local stand-ins for Ritual system contracts and precompiles.
/// Tests etch these runtimes at the canonical Ritual addresses so RitualPredict
/// exercises the same call path it uses on chain.
contract MockScheduler {
    struct ScheduledCall {
        address target;
        bytes data;
        uint32 gasLimit;
        uint32 startBlock;
        uint32 numCalls;
        uint32 frequency;
        uint32 ttl;
        uint256 maxFeePerGas;
        uint256 maxPriorityFeePerGas;
        address payer;
        bool cancelled;
    }

    uint256 public nextCallId;
    mapping(uint256 => ScheduledCall) private _calls;
    mapping(address => mapping(address => bool)) public approvals;

    function approveScheduler(address schedulerContract) external {
        approvals[msg.sender][schedulerContract] = true;
    }

    function schedule(
        bytes calldata data,
        uint32 gasLimit,
        uint32 startBlock,
        uint32 numCalls,
        uint32 frequency,
        uint32 ttl,
        uint256 maxFeePerGas,
        uint256 maxPriorityFeePerGas,
        uint256,
        address payer
    ) external returns (uint256 callId) {
        callId = ++nextCallId;
        _calls[callId] = ScheduledCall({
            target: msg.sender,
            data: data,
            gasLimit: gasLimit,
            startBlock: startBlock,
            numCalls: numCalls,
            frequency: frequency,
            ttl: ttl,
            maxFeePerGas: maxFeePerGas,
            maxPriorityFeePerGas: maxPriorityFeePerGas,
            payer: payer,
            cancelled: false
        });
    }

    function cancel(uint256 callId) external {
        ScheduledCall storage scheduled = _calls[callId];
        require(msg.sender == scheduled.target, "only target");
        scheduled.cancelled = true;
    }

    function getCallState(uint256 callId) external view returns (uint8) {
        if (_calls[callId].cancelled) return 3; // CANCELLED
        return 0; // SCHEDULED
    }

    function scheduledCall(
        uint256 callId
    )
        external
        view
        returns (
            address target,
            uint32 startBlock,
            uint32 numCalls,
            uint32 frequency,
            uint32 ttl,
            uint256 maxFeePerGas,
            uint256 maxPriorityFeePerGas,
            address payer,
            bool cancelled
        )
    {
        ScheduledCall storage scheduled = _calls[callId];
        return (
            scheduled.target,
            scheduled.startBlock,
            scheduled.numCalls,
            scheduled.frequency,
            scheduled.ttl,
            scheduled.maxFeePerGas,
            scheduled.maxPriorityFeePerGas,
            scheduled.payer,
            scheduled.cancelled
        );
    }

    function execute(address target, uint256 executionIndex, uint256 marketId) external {
        (bool ok, ) = target.call(
            abi.encodeWithSignature(
                "onScheduledResolve(uint256,uint256)",
                executionIndex,
                marketId
            )
        );
        require(ok, "scheduled call failed");
    }
}

contract MockRitualWallet {
    mapping(address => uint256) private _balances;
    mapping(address => uint256) private _lockUntil;

    function deposit(uint256 lockDuration) external payable {
        _balances[msg.sender] += msg.value;
        uint256 unlockBlock = block.number + lockDuration;
        if (unlockBlock > _lockUntil[msg.sender]) _lockUntil[msg.sender] = unlockBlock;
    }

    function balanceOf(address account) external view returns (uint256) {
        return _balances[account];
    }

    function lockUntil(address account) external view returns (uint256) {
        return _lockUntil[account];
    }
}

contract MockTEERegistry {
    address public executor;
    bool public found;

    function setExecutor(address executor_, bool found_) external {
        executor = executor_;
        found = found_;
    }

    function pickServiceByCapability(
        uint8,
        bool,
        uint256,
        uint256
    ) external view returns (address teeAddress, bool serviceFound) {
        return (executor, found);
    }
}

/// The bytes-returning fallback is deliberate. Ritual short-running precompiles return
/// raw bytes, so using a normal Solidity function returning bytes would add an extra ABI layer.
contract MockHTTPPrecompile {
    uint16 public status;
    bytes public body;
    string public errorMessage;
    bool public malformed;
    bool public shouldRevert;

    function setResponse(uint16 status_, bytes calldata body_, string calldata errorMessage_) external {
        status = status_;
        body = body_;
        errorMessage = errorMessage_;
    }

    function setMalformed(bool malformed_) external {
        malformed = malformed_;
    }

    function setShouldRevert(bool shouldRevert_) external {
        shouldRevert = shouldRevert_;
    }

    fallback(bytes calldata input) external returns (bytes memory) {
        if (shouldRevert) revert("mock HTTP revert");
        if (malformed) return hex"01";

        string[] memory headerKeys = new string[](0);
        string[] memory headerValues = new string[](0);
        bytes memory actualOutput = abi.encode(
            status,
            headerKeys,
            headerValues,
            body,
            errorMessage
        );
        return abi.encode(input, actualOutput);
    }
}

contract MockJQPrecompile {
    uint256 public value;
    bool public emptyOutput;

    function setValue(uint256 value_) external {
        value = value_;
    }

    function setEmptyOutput(bool emptyOutput_) external {
        emptyOutput = emptyOutput_;
    }

    fallback(bytes calldata) external returns (bytes memory) {
        if (emptyOutput) return bytes("");
        return abi.encode(value);
    }
}
