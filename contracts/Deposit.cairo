// Declare this file as a StarkNet contract and set the required
// builtins.
%lang starknet
%builtins pedersen range_check

from starkware.cairo.common.cairo_builtins import HashBuiltin
from starkware.starknet.common.syscalls import get_tx_signature
from starkware.cairo.common.math import unsigned_div_rem

from starkware.cairo.common.uint256 import Uint256, felt_to_uint256
from openzeppelin.token.erc20.library import ERC20
from starkware.starknet.common.syscalls import get_caller_address
from starkware.cairo.common.bool import TRUE, FALSE
from starkware.cairo.common.math import assert_not_zero

@contract_interface
namespace ITutorial {
      func  transferFrom(sender: felt, recipient: felt, amount: Uint256) {
            }
}

@event
func Deposit(user: felt, token: felt, maker: felt, target: felt, amount: Uint256, timestamp: Uint256) {
}

@constructor
func constructor{syscall_ptr: felt*, pedersen_ptr: HashBuiltin*, range_check_ptr}(
    ) {
  return ();
}

@view
func isOwltoTransfer{syscall_ptr: felt*, pedersen_ptr: HashBuiltin*, range_check_ptr}() -> (success: felt) {
      return (success=TRUE);
}

@external
func transfer{syscall_ptr: felt*, pedersen_ptr: HashBuiltin*, range_check_ptr}(
   target: felt, contract_address: felt, maker: felt, amount: Uint256
  ) -> (success: felt) {
    with_attr error_message("target cannot be zero") {
      assert_not_zero(target);
    }
    let (caller) = get_caller_address();
    ITutorial.transferFrom(contract_address=contract_address, sender=caller, recipient=maker, amount=amount);
    let timestamp = felt_to_uint256(0);
    Deposit.emit(caller, contract_address, maker, target, amount, timestamp);
    return (success=1);
}

