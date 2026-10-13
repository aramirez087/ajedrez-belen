// Pure offline diagnostics. No filesystem, subprocess, environment, network or project metadata.
const MAX_DIAGNOSTIC_RESPONSE_BYTES = 8 * 1024 * 1024;

export function classifyWranglerFailure(result, { binary = false } = {}) {
  if (result.status === 0 && !result.error && !result.signal) return 'no_failure';
  // Spawn failures are local evidence; never infer a provider response from them.
  const processFailure = {
    EPERM: 'local_access_denied', EACCES: 'local_access_denied', EROFS: 'local_access_denied',
    ENOENT: 'local_file_missing', ENOTDIR: 'local_file_missing', ENOSPC: 'local_storage_full',
    ETIMEDOUT: 'command_timeout', ENOBUFS: 'output_limit_exceeded',
  }[result.error?.code];
  if (result.error) return processFailure ?? 'bounded_command_failed';
  if (result.signal) return 'command_interrupted';
  const diagnostic = commandDiagnosticText(result, { binary });
  // Local errors must win over incidental words such as "Forbidden" in paths.
  if (/permission error occurred while accessing the file system|\b(?:EPERM|EACCES|EROFS)\b/i.test(diagnostic)) return 'local_access_denied';
  if (/file or directory could not be found|\b(?:ENOENT|ENOTDIR)\b/i.test(diagnostic)) return 'local_file_missing';
  if (/\bENOSPC\b|no space left on device/i.test(diagnostic)) return 'local_storage_full';
  if (/Unknown arguments?|Unknown command|Couldn't find a D1 DB|Missing required (?:option|flag)|Error parsing|Processing .* configuration|No account id found|mandatory to specify an account ID|More than one account available but unable to select/i.test(diagnostic)) return 'command_configuration_failed';
  if (/Unable to resolve Cloudflare's API hostname|\b(?:ENOTFOUND|EAI_AGAIN)\b/i.test(diagnostic)) return 'remote_dns_failed';
  if (/API timed out|\b(?:ETIMEDOUT|UND_ERR_CONNECT_TIMEOUT)\b/i.test(diagnostic)) return 'remote_timeout';
  if (/certificate mismatch|self-signed certificate|unable to verify the first certificate|unable to get local issuer certificate|\b(?:CERT_HAS_EXPIRED|DEPTH_ZERO_SELF_SIGNED_CERT)\b/i.test(diagnostic)) return 'remote_tls_failed';
  if (/auth server could not be reached|fetch failed|A fetch request failed|\b(?:ECONNREFUSED|ECONNRESET|ENETUNREACH|EHOSTUNREACH)\b/i.test(diagnostic)) return 'remote_network_failed';
  if (/\bSQLITE_(?:ERROR|TOOBIG|AUTH|NOMEM|FULL|BUSY|INTERRUPT|MISUSE)\b|no such (?:table|column|function)|incomplete input|syntax error|not authorized to use function|too many arguments|statement too long|too many terms in compound SELECT|parser stack overflow|expression tree is too large/i.test(diagnostic)) return 'remote_query_rejected';
  if (/no credentials found|no-credentials-non-interactive|token-expired-non-interactive|auth token has expired and could not be refreshed.*non-interactive|non-interactive environment.*(?:necessary|required) to set (?:a |the )?CLOUDFLARE_API_TOKEN|Did not login/i.test(diagnostic)) return 'authentication_required';
  if (/(?:^|\n)\s*(?:(?:✘|X)\s*)?(?:\[ERROR\]\s*)?(?:Error:\s*)?(?:Authentication error|Unauthorized|Forbidden)(?:[.:\s]|$)/i.test(diagnostic)
    || /["']?(?:status|code)["']?\s*:\s*(?:401|403|10000|9106|9109)\b/i.test(diagnostic)) return 'remote_auth_denied';
  if (/The specified key does not exist\./.test(diagnostic)) return 'missing';
  return 'read_failure_unknown';
}

function commandDiagnosticText(result, { binary = false } = {}) {
  // Successful result rows and R2 object bytes are never diagnostic input.
  const parts = [String(result.stderr ?? '').slice(0, 65_536)];
  if (!binary && typeof result.stdout === 'string' && Buffer.byteLength(result.stdout) <= MAX_DIAGNOSTIC_RESPONSE_BYTES) {
    try {
      const envelope = JSON.parse(result.stdout);
      const error = envelope && !Array.isArray(envelope) ? envelope.error : undefined;
      if (typeof error === 'string') parts.push(error.slice(0, 65_536));
      else if (error && typeof error === 'object' && !Array.isArray(error)) {
        for (const key of ['text', 'message']) if (typeof error[key] === 'string') parts.push(error[key].slice(0, 65_536));
        for (const key of ['status', 'code']) if ([401,403,10000,9106,9109].includes(error[key])) parts.push(`${key}: ${error[key]}`);
      }
    } catch { /* No diagnostic envelope: retain an unknown cause. */ }
  }
  return parts.join('\n');
}

export function sanitizedFailureDiagnostic(result, options = {}) {
  const category = classifyWranglerFailure(result, options);
  const layers = {
    no_failure: 'none', local_access_denied: 'local_filesystem', local_file_missing: 'local_filesystem',
    local_storage_full: 'local_filesystem', command_configuration_failed: 'local_configuration',
    authentication_required: 'credential_availability', command_timeout: 'local_command',
    output_limit_exceeded: 'local_command', command_interrupted: 'local_command', bounded_command_failed: 'local_command',
    remote_dns_failed: 'network', remote_timeout: 'network', remote_tls_failed: 'network', remote_network_failed: 'network',
    remote_query_rejected: 'reported_remote_query', remote_auth_denied: 'reported_remote_authorization',
    missing: 'reported_missing_object', read_failure_unknown: 'unknown',
  };
  const processCodes = ['EPERM','EACCES','EROFS','ENOENT','ENOTDIR','ENOSPC','ETIMEDOUT','ENOBUFS'];
  return { category, layer: layers[category], automaticRetry: false,
    ...(processCodes.includes(result.error?.code) ? { processCode: result.error.code } : {}),
    ...(category === 'remote_auth_denied' ? { authorizationCause: 'unknown' } : {}) };
}

