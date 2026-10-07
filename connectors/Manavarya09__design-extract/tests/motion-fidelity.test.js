import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { scoreMotionFidelity } from '../src/fidelity/motion-fidelity.js';

// A springy, kinetic original: spring easing, fast md transitions, a slide
// reveal keyframe, scroll-linked, a staggered sequence.
const springyOriginal = {
  feel: 'springy',
  durations: [{ name: 'sm', ms: 200 }, { name: 'md', ms: 320 }],
  easings: [{ family: 'spring', raw: 'cubic-bezier(.2,1.4,.4,1)', count: 8, overshoot: true }],
  springs: [{ family: 'spring', raw: 'cubic-bezier(.2,1.4,.4,1)' }],
  keyframes: [{ name: 'slideUp', kind: 'slide-y', used: true }, { name: 'fade', kind: 'fade', used: true }],
  scrollLinked: { present: true, signals: ['view:reveal'] },
  feelStat: {},
};

describe('scoreMotionFidelity — identity', () => {
  it('scores a clone that matches the original near-perfectly', () => {
    const { score, aspects } = scoreMotionFidelity(springyOriginal, springyOriginal, {
      originalChoreography: [{ staggerMs: 80 }],
      cloneChoreography: [{ staggerMs: 80 }],
    });
    assert.ok(score >= 98, `identity should be ~100, got ${score}`);
    assert.ok(aspects.every(a => a.score >= 0.99), 'every aspect should be perfect on identity');
  });
});

describe('scoreMotionFidelity — frozen clone', () => {
  it('heavily penalises a clone with no motion at all', () => {
    const frozen = { feel: null, durations: [], easings: [], springs: [], keyframes: [], scrollLinked: { present: false } };
    const { score, aspects } = scoreMotionFidelity(springyOriginal, frozen);
    assert.ok(score < 30, `frozen clone should score low, got ${score}`);
    const durations = aspects.find(a => a.aspect === 'durations');
    assert.equal(durations.score, 0, 'no-motion clone gets 0 on durations');
    assert.ok(durations.gap, 'a gap is reported for the missing motion');
  });

  it('flags the missing spring and scroll-linked motion explicitly', () => {
    const frozen = { feel: 'mechanical', durations: [{ ms: 300 }], easings: [{ family: 'linear', count: 1 }], springs: [], keyframes: [], scrollLinked: { present: false } };
    const { aspects } = scoreMotionFidelity(springyOriginal, frozen);
    assert.ok(aspects.find(a => a.aspect === 'springs').gap, 'reports missing spring');
    assert.ok(aspects.find(a => a.aspect === 'scrollLinked').gap, 'reports missing scroll-linked motion');
  });
});

describe('scoreMotionFidelity — partial match', () => {
  it('rewards close-but-not-exact durations and easings', () => {
    const close = {
      feel: 'responsive',
      durations: [{ ms: 220 }, { ms: 300 }], // within 25% of 200/320
      easings: [{ family: 'spring', count: 6 }],
      springs: [{ family: 'spring' }],
      keyframes: [{ name: 'slideUp', kind: 'slide-y', used: true }, { name: 'fade', kind: 'fade', used: true }],
      scrollLinked: { present: true },
    };
    const { score } = scoreMotionFidelity(springyOriginal, close);
    assert.ok(score > 75 && score < 100, `close clone should score high but not perfect, got ${score}`);
  });

  it('penalises over-animation more gently than missing motion', () => {
    const calmOriginal = { feel: 'smooth', durations: [{ ms: 300 }], easings: [{ family: 'ease-in-out', count: 4 }], springs: [], keyframes: [], scrollLinked: { present: false } };
    const overAnimated = { ...springyOriginal };
    const frozen = { feel: null, durations: [], easings: [], springs: [], keyframes: [], scrollLinked: { present: false } };
    const over = scoreMotionFidelity(calmOriginal, overAnimated).score;
    const missing = scoreMotionFidelity(springyOriginal, frozen).score;
    assert.ok(over > missing, `over-animation (${over}) should beat frozen (${missing})`);
  });
});

describe('scoreMotionFidelity — choreography', () => {
  it('penalises a flat clone of a staggered original', () => {
    const { aspects } = scoreMotionFidelity(springyOriginal, springyOriginal, {
      originalChoreography: [{ staggerMs: 80 }],
      cloneChoreography: [],
    });
    const choreo = aspects.find(a => a.aspect === 'choreography');
    assert.equal(choreo.score, 0, 'missing stagger scores 0');
    assert.ok(choreo.gap, 'reports the stagger gap');
  });
});

describe('scoreMotionFidelity — both static', () => {
  it('treats two motionless designs as a perfect match', () => {
    const still = { feel: null, durations: [], easings: [], springs: [], keyframes: [], scrollLinked: { present: false } };
    const { score } = scoreMotionFidelity(still, still);
    assert.equal(score, 100, 'nothing to reproduce → full credit');
  });
});
