import { APP_NPUB } from './app-identity.js';
import { isTowerPgBackendMode } from './backend-mode.js';
import {
  flightDeckSelfIndexAppPubkeyHex,
  publishWorkspaceSelfIndex,
  queryWorkspaceSelfIndexCandidates,
  workspaceSelfIndexRelayUrls,
} from './nostr-workspace-self-index.js';
import { mergeWorkspaceEntries } from './workspaces.js';

function errorMessage(error) {
  return error?.message || String(error || 'Workspace self-index failed');
}

function timestamp() {
  return new Date().toISOString();
}

export const workspaceSelfIndexManagerMixin = {
  workspaceSelfIndexRelayUrls(workspace = null) {
    return workspaceSelfIndexRelayUrls(
      this.currentWorkspace?.relayUrls || [],
      workspace?.relayUrls || [],
    );
  },

  applyWorkspaceSelfIndexPatch(workspace, patch = {}) {
    const workspaceKey = workspace?.workspaceKey || patch.workspaceKey || '';
    const current = workspaceKey
      ? this.knownWorkspaces.find((entry) => entry.workspaceKey === workspaceKey)
      : null;
    const next = mergeWorkspaceEntries(this.knownWorkspaces, [{
      ...(current || workspace || {}),
      ...patch,
    }]);
    this.knownWorkspaces = next;
    return workspaceKey
      ? this.knownWorkspaces.find((entry) => entry.workspaceKey === workspaceKey) || null
      : null;
  },

  async persistWorkspaceSelfIndexPatch(workspace, patch = {}) {
    const updated = this.applyWorkspaceSelfIndexPatch(workspace, patch);
    if (typeof this.persistWorkspaceSettings === 'function') {
      await this.persistWorkspaceSettings();
    }
    return updated;
  },

  async publishPgWorkspaceSelfIndex(workspace) {
    if (!isTowerPgBackendMode() || !workspace?.pgBackendMode || !this.session?.npub) return null;
    try {
      const result = await publishWorkspaceSelfIndex({
        workspace,
        userNpub: this.session.npub,
        userPubkeyHex: this.session.pubkey,
        relayUrls: this.workspaceSelfIndexRelayUrls(workspace),
        appNpub: APP_NPUB,
        appPubkeyHex: flightDeckSelfIndexAppPubkeyHex(APP_NPUB),
      });
      await this.persistWorkspaceSelfIndexPatch(workspace, {
        pgSelfIndexStatus: 'indexed',
        pgSelfIndexError: null,
        pgSelfIndexPublishedAt: result.publishedAt,
        pgSelfIndexEventId: result.event?.id || null,
        pgSelfIndexRelays: result.acceptedRelays,
      });
      return result;
    } catch (error) {
      await this.persistWorkspaceSelfIndexPatch(workspace, {
        pgSelfIndexStatus: 'failed',
        pgSelfIndexError: errorMessage(error),
        pgSelfIndexFailedAt: timestamp(),
      });
      return null;
    }
  },

  async discoverPgWorkspaceSelfIndex({ candidates = null } = {}) {
    if (!isTowerPgBackendMode() || !this.session?.npub) {
      return { discovered: 0, verified: 0, stale: 0, failed: 0 };
    }
    this.pgWorkspaceSelfIndexDiscovering = true;
    this.pgWorkspaceSelfIndexError = null;
    const summary = {
      discovered: 0,
      verified: 0,
      stale: 0,
      failed: 0,
      rejected: [],
    };
    try {
      const discovered = candidates
        ? { candidates, rejected: [], events: [] }
        : await queryWorkspaceSelfIndexCandidates({
          userNpub: this.session.npub,
          userPubkeyHex: this.session.pubkey,
          relayUrls: this.workspaceSelfIndexRelayUrls(),
          appPubkeyHex: flightDeckSelfIndexAppPubkeyHex(APP_NPUB),
        });
      summary.discovered = discovered.candidates.length;
      summary.rejected.push(...(discovered.rejected || []));

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
          await this.persistWorkspaceSelfIndexPatch(workspace, {
            pgSelfIndexStatus: 'verified',
            pgSelfIndexDiscoveredAt: timestamp(),
            pgSelfIndexVerifiedAt: timestamp(),
            pgSelfIndexEventId: candidate.event?.id || null,
          });
          summary.verified += 1;
        } catch (error) {
          summary.stale += 1;
          summary.rejected.push({
            eventId: candidate.event?.id || '',
            workspaceId: locator?.workspace_id || '',
            error: errorMessage(error),
          });
          const existing = this.knownWorkspaces.find((workspace) =>
            workspace.pgBackendMode
            && workspace.workspaceId === locator?.workspace_id
            && workspace.workspaceServiceNpub === locator?.workspace_service_npub
          );
          if (existing) {
            await this.persistWorkspaceSelfIndexPatch(existing, {
              pgSelfIndexStatus: 'stale',
              pgSelfIndexError: errorMessage(error),
              pgSelfIndexStaleAt: timestamp(),
            });
          }
        }
      }
      this.pgWorkspaceSelfIndexSummary = summary;
      return summary;
    } catch (error) {
      summary.failed += 1;
      this.pgWorkspaceSelfIndexError = errorMessage(error);
      this.pgWorkspaceSelfIndexSummary = summary;
      return summary;
    } finally {
      this.pgWorkspaceSelfIndexDiscovering = false;
    }
  },
};
