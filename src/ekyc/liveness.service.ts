import { Injectable, Logger } from '@nestjs/common';

export type LivenessAction =
  'blink' | 'smile' | 'turn_left' | 'turn_right' | 'nod';

export interface LivenessChallenge {
  /** Unique token to reference this challenge */
  challengeId: string;
  /** The action the user must perform */
  action: LivenessAction;
  /** Human-readable instruction */
  instruction: string;
  /** Unix epoch (ms) when this challenge was issued */
  issuedAt: number;
  /** TTL in seconds */
  expiresIn: number;
}

export interface LivenessResult {
  passed: boolean;
  action: LivenessAction;
  message: string;
}

const ACTIONS: { action: LivenessAction; instruction: string }[] = [
  { action: 'blink', instruction: 'Please blink both eyes' },
  { action: 'smile', instruction: 'Please smile at the camera' },
  {
    action: 'turn_left',
    instruction: 'Please turn your head slightly to the left',
  },
  {
    action: 'turn_right',
    instruction: 'Please turn your head slightly to the right',
  },
  { action: 'nod', instruction: 'Please nod your head up and down' },
];

/** TTL for a liveness challenge (seconds) */
const CHALLENGE_TTL_SECONDS = 60;

/**
 * Pseudo-liveness service.
 *
 * Issues a random challenge (blink / smile / turn / nod) that the mobile
 * client is expected to perform and then confirm. The server stores the
 * expected action in-memory; on submission it validates the claimed action
 * against the stored one and confirms the challenge has not expired.
 *
 * For production, replace `confirmChallenge` with a real ML check
 * (e.g. MediaPipe FaceMesh frame analysis or an anti-spoofing model).
 */
@Injectable()
export class LivenessService {
  private readonly logger = new Logger(LivenessService.name);

  /** In-memory store: challengeId → { action, issuedAt } */
  private readonly store = new Map<
    string,
    { action: LivenessAction; issuedAt: number }
  >();

  /** Issue a new random liveness challenge */
  issueChallenge(): LivenessChallenge {
    const entry = ACTIONS[Math.floor(Math.random() * ACTIONS.length)];
    const challengeId = crypto.randomUUID();
    const issuedAt = Date.now();

    this.store.set(challengeId, { action: entry.action, issuedAt });

    this.logger.log(
      `Issued liveness challenge [${challengeId}]: ${entry.action}`,
    );

    return {
      challengeId,
      action: entry.action,
      instruction: entry.instruction,
      issuedAt,
      expiresIn: CHALLENGE_TTL_SECONDS,
    };
  }

  /**
   * Confirm the liveness challenge.
   *
   * In this pseudo implementation, the client simply echoes back the
   * `challengeId` + `action`. In a real system you would also receive a
   * short video / frame sequence and run an anti-spoofing model.
   */
  confirmChallenge(
    challengeId: string,
    claimedAction: LivenessAction,
  ): LivenessResult {
    const stored = this.store.get(challengeId);

    if (!stored) {
      return {
        passed: false,
        action: claimedAction,
        message: 'Liveness challenge not found or already used',
      };
    }

    // Clean up immediately — each challenge is single-use
    this.store.delete(challengeId);

    const ageMs = Date.now() - stored.issuedAt;
    if (ageMs > CHALLENGE_TTL_SECONDS * 1000) {
      return {
        passed: false,
        action: claimedAction,
        message: `Liveness challenge expired (${Math.round(ageMs / 1000)}s old)`,
      };
    }

    if (claimedAction !== stored.action) {
      return {
        passed: false,
        action: claimedAction,
        message: `Wrong action — expected "${stored.action}", got "${claimedAction}"`,
      };
    }

    this.logger.log(
      `Liveness challenge [${challengeId}] PASSED: ${claimedAction}`,
    );
    return {
      passed: true,
      action: claimedAction,
      message: `Liveness check passed (${claimedAction})`,
    };
  }
}
