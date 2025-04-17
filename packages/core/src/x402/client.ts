import type { WalletClient, Address, Hex, TypedDataDefinition } from 'viem';
import { encodeAbiParameters, keccak256, bytesToHex, hexToBytes } from 'viem';
import { randomBytes } from 'node:crypto'; // For generating nonce
import { Buffer } from 'node:buffer'; // For Base64 encoding

// --- Interfaces based on the ticket description --- //

// Assuming PaymentDetails structure based on context
interface PaymentDetails {
  scheme: string;
  networkId: string;
  resource: string;
  payToAddress: Address;
  maxAmountRequired: string; // Use string for large numbers
  usdcAddress: Address;
  // Add other fields if specified in the finalized spec
}

interface X402Response {
  accepts: PaymentDetails[];
  // Add other potential fields from the 402 response body
}

// Parameters signed for EIP-3009 authorizeTransfer
interface EIP3009Authorization {
  from: Address;
  to: Address; // The spender (payToAddress)
  value: bigint;
  validAfter: bigint;
  validBefore: bigint;
  nonce: Hex; // Usually bytes32 hex string
}

// Payload for the X-PAYMENT header
interface XPaymentPayload {
  x402Version: number;
  scheme: string;
  networkId: string;
  resource: string;
  payload: {
    signature: Hex;
    authorization: EIP3009Authorization;
  };
}

// --- Custom Error Class --- //

export class X402Error extends Error {
  details?: Record<string, unknown>;

  constructor(message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'X402Error';
    this.details = details;
    Object.setPrototypeOf(this, X402Error.prototype);
  }
}

// --- Constants --- //
const SUPPORTED_SCHEME = 'exact';
const SUPPORTED_NETWORK_ID = '84532'; // Base Sepolia
const X402_VERSION = 1;
const VALIDITY_DURATION_SECONDS = 300; // 5 minutes

// EIP-712 Domain and Types for EIP-3009 AuthorizeTransfer (USDC example)
// Note: The exact domain might vary slightly based on the specific USDC contract deployment
const getDomain = (chainId: number, verifyingContract: Address) => ({
  name: 'USD Coin', // Standard name, confirm if different
  version: '2', // Common version, confirm if different
  chainId: chainId,
  verifyingContract: verifyingContract,
});

// Simplified type definition
const authorizeTransferTypes = {
  AuthorizeTransfer: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
} as const; // Remove 'satisfies TypedDataDefinition'

// --- Core Handler Function --- //

/**
 * Handles an HTTP 402 response, prompts for payment authorization, and generates the X-PAYMENT header value.
 *
 * @param response - The original Fetch API Response object (status 402).
 * @param walletClient - An initialized viem WalletClient instance.
 * @returns A promise that resolves with the Base64 encoded X-PAYMENT header value, or rejects with an X402Error.
 */
export async function handleX402Response(
  response: Response,
  walletClient: WalletClient
): Promise<string> {
  if (response.status !== 402) {
    throw new X402Error('Response status is not 402 Payment Required');
  }
  if (!walletClient.account) {
    throw new X402Error('WalletClient must have an account configured');
  }

  // Step 1: Parse response body
  let parsedBody: unknown;
  try {
    parsedBody = await response.json();
  } catch (e) {
    throw new X402Error('Failed to parse 402 response body as JSON', { error: e });
  }

  // Type assertion/validation after parsing
  const responseBody = parsedBody as X402Response;
  if (!responseBody || !Array.isArray(responseBody.accepts)) {
    throw new X402Error('Invalid 402 response format: missing or invalid "accepts" array', {
      parsedBody,
    });
  }

  // Step 2: Find suitable PaymentDetails
  const paymentDetails = responseBody.accepts.find(
    (details) => details.scheme === SUPPORTED_SCHEME && details.networkId === SUPPORTED_NETWORK_ID
  );

  if (!paymentDetails) {
    throw new X402Error(
      `No supported payment method found (scheme: ${SUPPORTED_SCHEME}, networkId: ${SUPPORTED_NETWORK_ID})`,
      { accepted: responseBody.accepts }
    );
  }

  // Basic validation of required fields
  if (
    !paymentDetails.payToAddress ||
    !paymentDetails.maxAmountRequired ||
    !paymentDetails.usdcAddress ||
    !paymentDetails.resource
  ) {
    throw new X402Error('Selected PaymentDetails missing required fields', {
      details: paymentDetails,
    });
  }

  // Step 3: Generate EIP-3009 parameters
  const from = walletClient.account.address;
  const to = paymentDetails.payToAddress;
  const value = BigInt(paymentDetails.maxAmountRequired); // Assuming amount is in smallest unit (e.g., 6 decimals for USDC)
  const validAfter = BigInt(Math.floor(Date.now() / 1000));
  const validBefore = validAfter + BigInt(VALIDITY_DURATION_SECONDS);
  const nonce = bytesToHex(randomBytes(32));

  const authorization: EIP3009Authorization = {
    from,
    to,
    value,
    validAfter,
    validBefore,
    nonce,
  };

  // Step 4: Request signature from walletClient
  let signature: Hex;
  try {
    const chainId = await walletClient.getChainId();
    if (chainId !== parseInt(SUPPORTED_NETWORK_ID, 10)) {
      throw new X402Error(
        `Wallet is connected to wrong chain ID ${chainId}, expected ${SUPPORTED_NETWORK_ID}`
      );
    }
    const domain = getDomain(chainId, paymentDetails.usdcAddress);

    signature = await walletClient.signTypedData({
      account: walletClient.account,
      domain: domain,
      types: authorizeTransferTypes,
      primaryType: 'AuthorizeTransfer',
      message: authorization,
    });
  } catch (e: any) {
    // Handle potential user rejection or other signing errors
    if (e.message?.includes('User rejected the request')) {
      throw new X402Error('User rejected payment authorization', { error: e });
    } else {
      throw new X402Error('Failed to sign payment authorization', { error: e });
    }
  }

  // Step 5: Construct XPaymentPayload
  const xPaymentJson: XPaymentPayload = {
    x402Version: X402_VERSION,
    scheme: paymentDetails.scheme,
    networkId: paymentDetails.networkId,
    resource: paymentDetails.resource,
    payload: {
      signature: signature,
      authorization: authorization,
    },
  };

  // Step 6: Base64 encode the payload string
  let xPaymentHeaderValue: string;
  try {
    const payloadString = JSON.stringify(xPaymentJson);
    xPaymentHeaderValue = Buffer.from(payloadString).toString('base64');
  } catch (e) {
    throw new X402Error('Failed to stringify or Base64 encode X-PAYMENT payload', { error: e });
  }

  // Step 7: Return encoded string
  return xPaymentHeaderValue;
}

// --- Fetch Wrapper --- //

interface FetchWithX402Init extends RequestInit {
  walletClient: WalletClient;
}

/**
 * A wrapper around the native fetch function that automatically handles x402 payment requests.
 *
 * @param input - URL or Request object.
 * @param init - Fetch options, including the required `walletClient`.
 * @returns A promise resolving to the final Response.
 */
export async function fetchWithX402(
  input: Request | string | URL,
  init: FetchWithX402Init
): Promise<Response> {
  const { walletClient, ...fetchOptions } = init;

  if (!walletClient) {
    throw new X402Error('walletClient must be provided in init options for fetchWithX402');
  }

  const originalResponse = await fetch(input, fetchOptions);

  if (originalResponse.status === 402) {
    console.log('Received 402, attempting payment...');
    try {
      // Clone the response body to allow reading it here and potentially later
      const responseClone = originalResponse.clone();
      const xPaymentHeader = await handleX402Response(responseClone, walletClient);

      const retryOptions = { ...fetchOptions };
      retryOptions.headers = new Headers(fetchOptions.headers); // Ensure headers object
      retryOptions.headers.set('X-PAYMENT', xPaymentHeader);

      console.log('Retrying request with X-PAYMENT header...');
      const retryResponse = await fetch(input, retryOptions);

      // Optional: Check if retry succeeded (e.g., status 2xx)
      // if (!retryResponse.ok) {
      //   console.warn(`x402 retry failed with status: ${retryResponse.status}`);
      //   // Decide whether to return retryResponse or throw
      // }
      return retryResponse;
    } catch (error) {
      console.error('Failed to handle x402 payment:', error);
      // If handleX402Response failed (e.g., user rejected, invalid details),
      // re-throw the specific X402Error for the caller to handle.
      if (error instanceof X402Error) {
        throw error;
      } else {
        // Otherwise, throw a generic error or return original response
        throw new X402Error('An unexpected error occurred during x402 handling', { cause: error });
        // return originalResponse; // Alternative: return original 402
      }
    }
  }

  return originalResponse;
}
