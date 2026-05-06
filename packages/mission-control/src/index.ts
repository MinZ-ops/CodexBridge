export const MISSION_CONTROL_PACKAGE_NAME = '@codexbridge/mission-control' as const;

export const MISSION_CONTROL_PACKAGE_PHASE = 'phase-0-bootstrap' as const;

export const MISSION_CONTROL_OWNS = [
  'mission-domain-model',
  'mission-state-machine',
  'workflow-loading',
  'workspace-coordination',
  'lease-coordination',
  'provider-abstraction',
  'run-verify-repair-retry-loop',
  'mission-persistence',
  'attempt-event-workpad-persistence',
  'mission-control-actions',
] as const;

export const MISSION_CONTROL_DOES_NOT_OWN = [
  'wechat-transport',
  'telegram-transport',
  'slash-commands',
  'i18n',
  'sendgate',
  'bridge-sessions',
  'thread-browsing',
  'provider-profile-cli-management',
  'assistant-records',
  'automations',
  'uploads',
  'artifact-delivery-policy',
] as const;

export type MissionControlOwnedResponsibility = typeof MISSION_CONTROL_OWNS[number];

export type MissionControlExcludedResponsibility =
  typeof MISSION_CONTROL_DOES_NOT_OWN[number];
