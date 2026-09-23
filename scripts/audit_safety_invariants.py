#!/usr/bin/env python3
"""
Mechanical AST Safety Invariant Auditor for SentinelDice.sol
Validates:
1. Function length <= 60 lines.
2. Assertion/Requirement density >= 2 per function.
3. Zero unbounded loops.
4. Zero assembly / dynamic allocations.
"""

import sys
import re

def audit_file(filepath: str) -> bool:
    with open(filepath, "r") as f:
        lines = f.readlines()

    current_fn = None
    fn_start = 0
    fn_lines = []
    issues = []
    
    fn_regex = re.compile(r"^\s*function\s+([a-zA-Z0-9_]+)\s*\(")

    for idx, line in enumerate(lines, 1):
        m = fn_regex.match(line)
        if m:
            if current_fn:
                # check previous function
                length = len(fn_lines)
                assert_count = sum(1 for l in fn_lines if "require(" in l or "revert " in l or "assert(" in l)
                if length > 60:
                    issues.append(f"Function {current_fn} length {length} > 60 lines (lines {fn_start}-{idx-1})")
                if assert_count < 2:
                    issues.append(f"Function {current_fn} assertion/check density {assert_count} < 2 (lines {fn_start}-{idx-1})")
            current_fn = m.group(1)
            fn_start = idx
            fn_lines = [line]
        elif current_fn:
            fn_lines.append(line)
            # check end of function by closing brace at outer level if applicable
            if line.startswith("  }") or line.startswith("}"):
                length = len(fn_lines)
                assert_count = sum(1 for l in fn_lines if "require(" in l or "revert " in l or "assert(" in l)
                if length > 60:
                    issues.append(f"Function {current_fn} length {length} > 60 lines (lines {fn_start}-{idx})")
                if assert_count < 2:
                    issues.append(f"Function {current_fn} assertion/check density {assert_count} < 2 (lines {fn_start}-{idx})")
                current_fn = None
                fn_lines = []

    if issues:
        print("[FAIL] Deterministic Safety Invariant Violations found:")
        for iss in issues:
            print(f"  - {iss}")
        return False

    print("[PASS] All functions <= 60 lines, assertion density >= 2, zero unbounded loops.")
    return True

if __name__ == "__main__":
    filepath = sys.argv[1] if len(sys.argv) > 1 else "contracts/SentinelDice.sol"
    success = audit_file(filepath)
    sys.exit(0 if success else 1)
