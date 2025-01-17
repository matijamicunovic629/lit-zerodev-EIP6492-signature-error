# Lit ZeroDev EIP-6492 Signature Error

This repository demonstrates using the Account Abstraction (AA) feature with ZeroDev while integrating the Lit Protocol for managing session-based PKP wallets and EOA wallets. The goal is to create and verify EIP-6492 signatures for both types of wallets. While the EIP-6492 signature verification works fine with the EOA wallet, it results in a false verification result for the PKP wallet.

## Problem Description

To use the AA feature with ZeroDev, we rely on an **ECDSA validator** as the key abstraction for both **EOA wallets** and **PKP wallets**. However, there is a discrepancy when verifying EIP-6492 signatures:

- **With EOA Wallet**: The signature is successfully created and verified.
- **With PKP Wallet**: The signature creation succeeds, but verification fails (result is `false`).
