const STEP_KEYS = ["place", "region", "distance", "difficulty", "style"];

export function initialWizardState() {
  return {
    step: 0,
    answers: {
      place: null,
      region: null,
      distance: null,
      difficulty: null,
      style: null,
    },
  };
}

function nextStepAfter(stepIndex, answers) {
  if (stepIndex === 0 && answers.place && answers.place !== "any") {
    return 2;
  }
  return stepIndex + 1;
}

function prevStepFrom(stepIndex, answers) {
  if (stepIndex === 0) return 0;
  if (stepIndex === 2 && answers.place && answers.place !== "any") {
    return 0;
  }
  return stepIndex - 1;
}

export function wizardReducer(state, action) {
  switch (action.type) {
    case "ANSWER": {
      const answers = { ...state.answers, [action.key]: action.value };
      const answeredAt = STEP_KEYS.indexOf(action.key);
      const step = nextStepAfter(answeredAt, answers);
      return { step, answers };
    }
    case "BACK":
      return { ...state, step: prevStepFrom(state.step, state.answers) };
    case "RESET":
      return initialWizardState();
    default:
      return state;
  }
}

export const WIZARD_STEP_COUNT = STEP_KEYS.length;
export const WIZARD_STEP_KEYS = STEP_KEYS;
