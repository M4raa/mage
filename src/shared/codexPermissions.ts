// Presets de Mage sobre los perfiles que expone `permissionProfile/list` de Codex.
// El separador no forma parte de los ids del CLI (`:workspace`), y conserva el perfil crudo anterior.
export type CodexApprovalPolicy = 'on-request' | 'never';

export interface CodexPermissionPreset {
  readonly profile: string;
  readonly approvalPolicy: CodexApprovalPolicy;
}

export function parseCodexPermissionPreset(value: string): CodexPermissionPreset | null {
  const [profile, policy, extra] = value.split('|');
  if (extra !== undefined || profile === undefined || !/^:[a-z][a-z-]*$/.test(profile)) return null;
  if (policy === undefined) return { profile, approvalPolicy: 'on-request' };
  if (policy !== 'on-request' && policy !== 'never') return null;
  return { profile, approvalPolicy: policy };
}

export function codexPermissionPreset(profile: string, policy: CodexApprovalPolicy): string {
  return policy === 'on-request' ? profile : `${profile}|${policy}`;
}
