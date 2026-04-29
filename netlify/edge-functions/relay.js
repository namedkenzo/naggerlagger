// Configuration: The upstream server address must be provided via environment variable "BACKEND_SERVER"
const BACKEND_SERVER = (Netlify.env.get("BACKEND_SERVER") || "").replace(/\/$/, "");

// List of headers to remove when forwarding the request
const FILTERED_HEADERS = new Set([
    "host",
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
    "forwarded",
    "x-forwarded-host",
    "x-forwarded-proto",
    "x-forwarded-port",
]);

/**
 * Processes incoming requests and forwards them to the target backend.
 */
export default async function handleRequest(request) {
    // Validate backend configuration
    if (!BACKEND_SERVER) {
        return new Response("Configuration error: BACKEND_SERVER is not defined.", { status: 500 });
    }

    try {
        // Construct the full target URL using the incoming path and query string
        const incomingUrl = new URL(request.url);
        const targetUrl = BACKEND_SERVER + incomingUrl.pathname + incomingUrl.search;

        // Prepare headers for the forwarded request
        const requestHeaders = new Headers();
        let originalClientIp = null;

        for (const [headerName, headerValue] of request.headers) {
            const normalizedKey = headerName.toLowerCase();

            // Skip headers that should be filtered out
            if (FILTERED_HEADERS.has(normalizedKey)) continue;
            if (normalizedKey.startsWith("x-nf-")) continue;
            if (normalizedKey.startsWith("x-netlify-")) continue;

            // Capture the client's original IP from standard headers
            if (normalizedKey === "x-real-ip") {
                originalClientIp = headerValue;
                continue;
            }
            if (normalizedKey === "x-forwarded-for") {
                if (!originalClientIp) originalClientIp = headerValue;
                continue;
            }

            requestHeaders.set(headerName, headerValue);
        }

        // Preserve the original client IP in the forwarded request
        if (originalClientIp) {
            requestHeaders.set("x-forwarded-for", originalClientIp);
        }

        const requestMethod = request.method;
        const doesBodyExist = requestMethod !== "GET" && requestMethod !== "HEAD";
        
        const fetchConfig = {
            method: requestMethod,
            headers: requestHeaders,
            redirect: "manual",
        };

        if (doesBodyExist) {
            fetchConfig.body = request.body;
        }

        // Forward the request to the target server
        const upstreamResponse = await fetch(targetUrl, fetchConfig);

        // Build the response headers to return to the client
        const responseHeaders = new Headers();
        for (const [headerKey, headerValue] of upstreamResponse.headers) {
            // Skip problematic encoding header
            if (headerKey.toLowerCase() === "transfer-encoding") continue;
            responseHeaders.set(headerKey, headerValue);
        }

        return new Response(upstreamResponse.body, {
            status: upstreamResponse.status,
            headers: responseHeaders,
        });

    } catch (error) {
        return new Response("Proxy error: Unable to reach the upstream server.", { status: 502 });
    }
}
