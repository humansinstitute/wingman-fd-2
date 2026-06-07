import { APP_NPUB } from './app-identity.js';
import { buildAgentConnectPackage } from './agent-connect.js';
import { isTowerPgBackendMode } from './backend-mode.js';
import {
  flightDeckOnboardingAppPubkeyHex,
  onboardingAnnouncementRelayUrls,
  publishOnboardingAnnouncement,
  queryOnboardingAnnouncementCandidates,
} from './nostr-onboarding-announcements.js';
import { buildSuperBasedConnectionToken } from './superbased-token.js';

function errorMessage(error) {
  return error?.message || String(error || 'Onboarding announcement failed');
}

function timestamp() {
  return new Date().toISOString();
}

function trimText(value) {
  return String(value ?? '').trim();
}

function currentOrigin() {
  return typeof window !== 'undefined' ? window.location.origin : '';
}

function statusKey({ recipientNpub = '', workspace = {}, grantId = '' } = {}) {
  return [
    trimText(recipientNpub),
    trimText(workspace.workspaceId || workspace.workspace_id),
    trimText(workspace.workspaceServiceNpub || workspace.workspace_service_npub),
    trimText(grantId),
  ].join('::');
}

function buildConnectionToken(workspace = {}, backendUrl = '') {
  return trimText(workspace.connectionToken) || buildSuperBasedConnectionToken({
    directHttpsUrl: workspace.directHttpsUrl || backendUrl,
    serviceNpub: workspace.towerServiceNpub || workspace.serviceNpub || '',
    towerName: workspace.towerName || '',
    towerDescription: workspace.towerDescription || '',
    workspaceOwnerNpub: workspace.workspaceOwnerNpub || '',
    appNpub: APP_NPUB,
    relayUrls: workspace.relayUrls || [],
  });
}

export const onboardingAnnouncementsManagerMixin = {
  async refreshPgNostrWorkspaceDiscovery() {
    const onboarding = await this.discoverPgOnboardingAnnouncements?.();
    const selfIndex = await this.discoverPgWorkspaceSelfIndex?.();
    await this.loadRemoteWorkspaces?.();
    if (!this.selectedWorkspaceKey && this.knownWorkspaces?.length > 0) {
      this.selectedWorkspaceKey = this.knownWorkspaces[0].workspaceKey || '';
      this.currentWorkspaceOwnerNpub = this.knownWorkspaces[0].workspaceOwnerNpub || this.currentWorkspaceOwnerNpub;
    }
    if (this.selectedWorkspaceKey || this.currentWorkspaceOwnerNpub) {
      await this.selectWorkspace?.(this.selectedWorkspaceKey || this.currentWorkspaceOwnerNpub, { refresh: false });
    }
    await this.persistWorkspaceSettings?.();
    return { onboarding, selfIndex };
  },

  onboardingAnnouncementRelayUrls(workspace = null) {
    return onboardingAnnouncementRelayUrls(
      this.currentWorkspace?.relayUrls || [],
      workspace?.relayUrls || [],
    );
  },

  rememberOnboardingAnnouncementStatus(input = {}) {
    const key = statusKey(input);
    const entry = {
      key,
      recipientNpub: trimText(input.recipientNpub),
      workspaceId: trimText(input.workspace?.workspaceId || input.workspace?.workspace_id),
      workspaceServiceNpub: trimText(input.workspace?.workspaceServiceNpub || input.workspace?.workspace_service_npub),
      grantId: trimText(input.grantId),
      reason: trimText(input.reason) || 'added_to_workspace_or_group',
      status: input.status,
      error: input.error || null,
      eventId: input.eventId || null,
      relays: input.relays || [],
      updatedAt: timestamp(),
      retryInput: input.retryInput || null,
    };
    const current = Array.isArray(this.pgOnboardingAnnouncementStatuses)
      ? this.pgOnboardingAnnouncementStatuses
      : [];
    const index = current.findIndex((item) => item.key === key);
    if (index >= 0) current.splice(index, 1, entry);
    else current.unshift(entry);
    this.pgOnboardingAnnouncementStatuses = current.slice(0, 50);
    return entry;
  },

  buildPgOnboardingAgentConnectPackage(workspace = this.currentWorkspace) {
    const token = buildConnectionToken(workspace, this.backendUrl);
    return buildAgentConnectPackage({
      windowOrigin: currentOrigin(),
      backendUrl: workspace?.directHttpsUrl || this.backendUrl,
      session: {
        ...(this.session || {}),
        npub: workspace?.workspaceOwnerNpub || this.session?.npub || '',
      },
      token,
      towerName: workspace?.towerName || '',
      towerDescription: workspace?.towerDescription || '',
    });
  },

  async publishPgOnboardingAnnouncementForGrant({
    recipientNpub,
    workspace = this.currentWorkspace,
    grantId = '',
    reason = 'added_to_workspace_or_group',
  } = {}) {
    if (!isTowerPgBackendMode() || !workspace?.pgBackendMode) return null;
    const cleanRecipient = trimText(recipientNpub);
    const retryInput = { recipientNpub: cleanRecipient, workspace, grantId, reason };
    if (!this.session?.npub || !this.session?.pubkey) {
      return this.rememberOnboardingAnnouncementStatus({
        ...retryInput,
        status: 'failed',
        error: 'Sign in with a Nostr signer before publishing onboarding announcements.',
        retryInput,
      });
    }
    if (!cleanRecipient?.startsWith('npub1')) {
      return this.rememberOnboardingAnnouncementStatus({
        ...retryInput,
        status: 'failed',
        error: 'Recipient npub is required.',
        retryInput,
      });
    }

    this.rememberOnboardingAnnouncementStatus({
      ...retryInput,
      status: 'publishing',
      retryInput,
    });

    try {
      const result = await publishOnboardingAnnouncement({
        recipientNpub: cleanRecipient,
        issuerNpub: this.session.npub,
        issuerPubkeyHex: this.session.pubkey,
        workspace,
        agentConnect: this.buildPgOnboardingAgentConnectPackage(workspace),
        relayUrls: this.onboardingAnnouncementRelayUrls(workspace),
        appNpub: APP_NPUB,
        appPubkeyHex: flightDeckOnboardingAppPubkeyHex(APP_NPUB),
        grantId,
        reason,
      });
      return this.rememberOnboardingAnnouncementStatus({
        ...retryInput,
        status: 'published',
        eventId: result.event?.id || null,
        relays: result.acceptedRelays || [],
        retryInput,
      });
    } catch (error) {
      return this.rememberOnboardingAnnouncementStatus({
        ...retryInput,
        status: 'failed',
        error: errorMessage(error),
        retryInput,
      });
    }
  },

  async retryPgOnboardingAnnouncement(statusOrKey) {
    const key = typeof statusOrKey === 'string' ? statusOrKey : statusOrKey?.key;
    const entry = (this.pgOnboardingAnnouncementStatuses || []).find((item) => item.key === key) || statusOrKey;
    if (!entry?.retryInput) return null;
    return this.publishPgOnboardingAnnouncementForGrant(entry.retryInput);
  },

  async discoverPgOnboardingAnnouncements({ candidates = null } = {}) {
    if (!isTowerPgBackendMode() || !this.session?.npub) {
      return { discovered: 0, eventsSeen: 0, verified: 0, stale: 0, failed: 0, rejected: [] };
    }
    this.pgOnboardingAnnouncementDiscovering = true;
    this.pgOnboardingAnnouncementError = null;
    const summary = {
      discovered: 0,
      eventsSeen: 0,
      verified: 0,
      stale: 0,
      failed: 0,
      rejected: [],
    };
    try {
      const discovered = candidates
        ? { candidates, rejected: [], events: [] }
        : await queryOnboardingAnnouncementCandidates({
          userNpub: this.session.npub,
          userPubkeyHex: this.session.pubkey,
          relayUrls: this.onboardingAnnouncementRelayUrls(),
          appPubkeyHex: flightDeckOnboardingAppPubkeyHex(APP_NPUB),
        });
      summary.eventsSeen = discovered.events?.length || discovered.candidates.length || 0;
      summary.discovered = discovered.candidates.length;
      summary.rejected.push(...(discovered.rejected || []));
      if (summary.eventsSeen > 0 && summary.discovered === 0 && summary.rejected.length > 0) {
        this.pgOnboardingAnnouncementError = `Found ${summary.eventsSeen} onboarding event${summary.eventsSeen === 1 ? '' : 's'} but none could be decrypted or accepted. Check this browser's Nostr signer and relay access.`;
      }

      for (const candidate of discovered.candidates) {
        const locator = candidate.locator;
        try {
          const { descriptor, me } = await this.verifyPgDescriptor(locator, {
            baseUrl: locator.tower_base_url,
          });
          const workspace = await this.rememberVerifiedPgWorkspace(descriptor, me, {
            select: false,
            publishSelfIndex: false,
          });
          if (!this.selectedWorkspaceKey && workspace?.workspaceKey) {
            this.selectedWorkspaceKey = workspace.workspaceKey;
            this.currentWorkspaceOwnerNpub = workspace.workspaceOwnerNpub || this.currentWorkspaceOwnerNpub;
          }
          summary.verified += 1;
          summary.rejected.push({
            eventId: candidate.event?.id || '',
            status: 'verified',
            workspaceId: locator?.identity?.workspace_id || locator?.workspace_id || '',
          });
        } catch (error) {
          summary.stale += 1;
          summary.rejected.push({
            eventId: candidate.event?.id || '',
            workspaceId: locator?.identity?.workspace_id || locator?.workspace_id || '',
            error: errorMessage(error),
          });
        }
      }
      this.pgOnboardingAnnouncementSummary = summary;
      return summary;
    } catch (error) {
      summary.failed += 1;
      this.pgOnboardingAnnouncementError = errorMessage(error);
      this.pgOnboardingAnnouncementSummary = summary;
      return summary;
    } finally {
      this.pgOnboardingAnnouncementDiscovering = false;
    }
  },
};
