import { useEffect, useRef, useState } from "react";
import { text } from "../theme/typography.js";
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Image,
  StyleSheet,
  View,
} from "react-native";

const SPLASH_IMAGE = require("../../assets/splash-screen-ios.png");

// Playful "getting ready to ride" flavor shown while the app boots, in place of
// literal loading milestones. A random phrase is picked per launch (so each cold
// start differs) and they rotate while the splash is up.
const LAUNCH_PHRASES = [
  "מחמם מנועים",
  "בודק אוויר בצמיגים",
  "משמן את השרשרת",
  "מהדק את הקסדה",
  "בודק בלמים",
  "מותח שרירים",
  "מודד רוח גבית",
];
// The splash floor is short (MIN_LAUNCH_SPLASH_MS ≈ 1.2s), so a fast launch
// shows one phrase — the per-launch random start is what gives variety. 1.5s
// reads comfortably while still rotating a second/third phrase on slow cold
// starts. Tune here.
const PHRASE_INTERVAL_MS = 750;

function randomPhraseIndex(exclude = -1) {
  if (LAUNCH_PHRASES.length <= 1) return 0;
  let next = exclude;
  while (next === exclude) {
    next = Math.floor(Math.random() * LAUNCH_PHRASES.length);
  }
  return next;
}

export default function AnimatedLaunchSplash({
  progress = 0.1,
  ready = false,
  onFirstLayout,
  onFinished,
}) {
  const [reduceMotion, setReduceMotion] = useState(false);
  const [phraseIndex, setPhraseIndex] = useState(() => randomPhraseIndex());
  const phraseOpacity = useRef(new Animated.Value(1)).current;
  const opacity = useRef(new Animated.Value(1)).current;
  const imageScale = useRef(new Animated.Value(0.995)).current;
  const progressValue = useRef(new Animated.Value(progress)).current;
  const pulseOpacity = useRef(new Animated.Value(0.35)).current;
  const entranceRef = useRef(null);
  const pulseRef = useRef(null);

  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (mounted) setReduceMotion(Boolean(enabled));
      })
      .catch(() => {});
    const subscription = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      (enabled) => setReduceMotion(Boolean(enabled)),
    );
    return () => {
      mounted = false;
      subscription?.remove?.();
    };
  }, []);

  useEffect(() => {
    Animated.timing(progressValue, {
      toValue: Math.max(0.08, Math.min(1, progress)),
      duration: reduceMotion ? 0 : 260,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [progress, progressValue, reduceMotion]);

  useEffect(() => {
    entranceRef.current?.stop?.();
    pulseRef.current?.stop?.();
    if (reduceMotion) {
      imageScale.setValue(1);
      pulseOpacity.setValue(0.7);
      return undefined;
    }

    entranceRef.current = Animated.timing(imageScale, {
      toValue: 1.008,
      duration: 1500,
      easing: Easing.inOut(Easing.sin),
      useNativeDriver: true,
    });
    pulseRef.current = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseOpacity, {
          toValue: 0.95,
          duration: 430,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(pulseOpacity, {
          toValue: 0.35,
          duration: 430,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );
    entranceRef.current.start();
    pulseRef.current.start();

    return () => {
      entranceRef.current?.stop?.();
      pulseRef.current?.stop?.();
    };
  }, [imageScale, pulseOpacity, reduceMotion]);

  useEffect(() => {
    if (!ready) return;
    entranceRef.current?.stop?.();
    pulseRef.current?.stop?.();
    Animated.timing(opacity, {
      toValue: 0,
      duration: reduceMotion ? 80 : 260,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) onFinished?.();
    });
  }, [onFinished, opacity, ready, reduceMotion]);

  // Rotate the flavor phrase while the splash is up. Once `ready` fires the
  // whole view fades out, so stop cycling to avoid a flicker mid-dismiss.
  useEffect(() => {
    if (ready) return undefined;
    const id = setInterval(() => {
      if (reduceMotion) {
        setPhraseIndex((current) => randomPhraseIndex(current));
        return;
      }
      Animated.timing(phraseOpacity, {
        toValue: 0,
        duration: 200,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (!finished) return;
        setPhraseIndex((current) => randomPhraseIndex(current));
        Animated.timing(phraseOpacity, {
          toValue: 1,
          duration: 240,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }).start();
      });
    }, PHRASE_INTERVAL_MS);
    return () => clearInterval(id);
  }, [phraseOpacity, ready, reduceMotion]);

  const phrase = LAUNCH_PHRASES[phraseIndex];

  return (
    <Animated.View
      accessibilityLabel={phrase}
      accessibilityLiveRegion="polite"
      accessibilityRole="progressbar"
      onLayout={onFirstLayout}
      style={[styles.root, { opacity }]}
    >
      <Animated.View
        pointerEvents="none"
        style={[styles.imageWrap, { transform: [{ scale: imageScale }] }]}
      >
        <Image source={SPLASH_IMAGE} resizeMode="contain" style={styles.image} />
      </Animated.View>

      <View style={styles.loading}>
        <View style={styles.statusRow}>
          <Animated.View style={[styles.pulse, { opacity: pulseOpacity }]} />
          <Animated.Text style={[styles.status, { opacity: phraseOpacity }]}>
            {phrase}
          </Animated.Text>
        </View>
        <View style={styles.progressTrack}>
          <Animated.View
            style={[
              styles.progressFill,
              { transform: [{ scaleX: progressValue }] },
            ]}
          />
        </View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 1000,
    overflow: "hidden",
    backgroundColor: "#ededed",
  },
  imageWrap: {
    ...StyleSheet.absoluteFillObject,
  },
  image: {
    width: "100%",
    height: "100%",
  },
  loading: {
    position: "absolute",
    right: 0,
    bottom: 72,
    left: 0,
    alignItems: "center",
    gap: 10,
  },
  statusRow: {
    flexDirection: "row-reverse",
    alignItems: "center",
    gap: 8,
  },
  pulse: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: "#3f5d33",
  },
  status: {
    ...text.captionStrong,
    color: "#46514b",
    textAlign: "center",
    writingDirection: "rtl",
  },
  progressTrack: {
    width: 176,
    height: 3,
    overflow: "hidden",
    borderRadius: 999,
    backgroundColor: "rgba(63, 93, 51, 0.17)",
  },
  progressFill: {
    width: "100%",
    height: "100%",
    borderRadius: 999,
    backgroundColor: "#3f5d33",
    transformOrigin: "right",
  },
});
