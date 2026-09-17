/**
 * Recovered from WorkoutDemo-cLuzxzv9.js, deployment 6aa9b6f0d8faf6177db8fd97.
 * See RECOVERY.md. JSX-runtime calls preserve the published element tree.
 */
import * as React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { MagicCard } from "../../../components/magicui/magic-card";
import { BlurFade } from "../../../components/magicui/blur-fade";
import { TacticalIcon } from "../TacticalIcon";
import { DemoPitch } from "./DrillDiagram";
import { DrillMedia } from "./DrillMedia";
import { createDemoWorkout, formatDuration, workoutReducer, formatDose, initialWorkoutState, focusFromRequest } from "./product-demo";
import { focusWorkoutHeading } from "./workout-focus";
import "./product-demo.css";
import "./workout-section.css";
function CheckIcon() {
    return (0, jsxRuntime.jsx)(`svg`, {
        viewBox: `0 0 20 20`, fill: `none`, "aria-hidden": `true`, children: (0, jsxRuntime.jsx)(`path`, {
            d: `m4 10 4 4 8-8`, stroke: `currentColor`, strokeWidth: `1.5`, strokeLinecap: `round`, strokeLinejoin: `round`
        })
    });
}
function WorkoutDemo({ active = true, initialRequest = ``, requestId = 0 }) {
    let [choices, setChoices] = (0, React.useState)({
        minutes: initialRequest ? 20 : 30, energy: `normal`, focus: focusFromRequest(initialRequest)
    });
    const [selectedDrillIndex, setSelectedDrillIndex] = React.useState(0);
    let [choosingFocus, setChoosingFocus] = (0, React.useState)(!!initialRequest);
    let [preparationStep, setPreparationStep] = (0, React.useState)(0);
    let [state, dispatch] = (0, React.useReducer)(workoutReducer, choices, choices => ({ ...initialWorkoutState, step: `review`, workout: createDemoWorkout(choices) }));
    let [inView, setInView] = (0, React.useState)(false);
    let [documentVisible, setDocumentVisible] = (0, React.useState)(true);
    let containerRef = (0, React.useRef)(null);
    let shouldFocusRef = (0, React.useRef)(false);
    let previousRequestRef = (0, React.useRef)({ text: initialRequest, id: requestId });
    let headingId = (0, React.useId)();
    (0, React.useEffect)(() => {
        if (!(!initialRequest || (initialRequest === previousRequestRef.current.text && requestId === previousRequestRef.current.id))) {
            previousRequestRef.current = { text: initialRequest, id: requestId };
            setChoices({
                minutes: 20, energy: `normal`, focus: focusFromRequest(initialRequest)
            });
            setChoosingFocus(true);
            dispatch({ type: `prepare`, choices: { minutes: 20, energy: `normal`, focus: focusFromRequest(initialRequest) } });
            dispatch({ type: `ready` });
        }
    }, [initialRequest, requestId]);
    (0, React.useEffect)(() => {
        let e = () => setDocumentVisible(!document.hidden);
        if (e(), document.addEventListener(`visibilitychange`, e), !containerRef.current || typeof IntersectionObserver > `u`)
            return setInView(true), () => document.removeEventListener(`visibilitychange`, e);
        let t = new IntersectionObserver(([e]) => setInView(e.isIntersecting), {
            threshold: .1
        });
        return t.observe(containerRef.current), () => {
            t.disconnect();
            document.removeEventListener(`visibilitychange`, e);
        };
    }, []);
    (0, React.useEffect)(() => {
        if (!active || !inView || !documentVisible || state.step !== `training` || state.paused)
            return;
        let t = performance.now();
        let n = window.setInterval(() => {
            let e = performance.now();
            dispatch({
                type: `tick`, seconds: (e - t) / 1e3
            });
            t = e;
        }, 250);
        return () => window.clearInterval(n);
    }, [active, inView, documentVisible, state.step, state.paused]);
    (0, React.useEffect)(() => {
        if (state.step === `intake`) {
            setPreparationStep(0);
        }
    }, [state.step]);
    (0, React.useEffect)(() => {
        if (state.step !== `preparing` || !active || !inView || !documentVisible)
            return;
        if (window.matchMedia(`(prefers-reduced-motion: reduce)`).matches || preparationStep >= 3) {
            dispatch({
                type: `ready`
            });
            return;
        }
        let t = window.setTimeout(() => setPreparationStep(e => e + 1), 300);
        return () => window.clearTimeout(t);
    }, [state.step, preparationStep, active, inView, documentVisible]);
    (0, React.useEffect)(() => {
        if (!active) {
            shouldFocusRef.current = false;
            return;
        }
        if (!(!shouldFocusRef.current || state.step === `preparing`)) {
            shouldFocusRef.current = false;
            focusWorkoutHeading(containerRef.current);
        }
    }, [state.step, choosingFocus, active]);
    let workout = state.workout;
    let currentSegment = workout?.segments[state.segment];
    let currentDrill = currentSegment && workout?.drills[currentSegment.drill];
    let totalSets = workout?.drills.reduce((e, t) => e + t.sets, 0) || 0;
    let stepLabels = [`Your day`, `Your workout`, `Your session`, `Your summary`];
    let activeStep = state.step === `preparing` ? 1 : [`intake`, `review`, `training`, `summary`].indexOf(state.step);
    let focus = workout?.choices.focus || choices.focus;
    let focusContext = {
        dribbling: `Build your ball control`,
        passing: `Find your passing rhythm`
    }[focus];
    let updateChoice = (e, t) => setChoices(n => ({
        ...n, [e]: t
    }));
    let transition = e => {
        shouldFocusRef.current = true;
        dispatch(e);
    };
    let setFocusStep = e => {
        shouldFocusRef.current = true;
        setChoosingFocus(e);
    };
    return (0, jsxRuntime.jsxs)(`div`, {
        ref: containerRef, className: `product-demo workout-demo`, "aria-labelledby": headingId, children: [
            (0, jsxRuntime.jsxs)(`div`, {
                className: `pd-topbar`, children: [
                    (0, jsxRuntime.jsx)(`span`, {
                        className: `pd-appmark`, "aria-hidden": `true`, children: `P`
                    }), (0, jsxRuntime.jsx)(`span`, {
                        children: `Training`
                    }), (0, jsxRuntime.jsx)(`span`, {
                        className: `pd-sample-label`, children: `Interactive demo`
                    })
                ]
            }), (0, jsxRuntime.jsxs)(`div`, {
                className: `pd-workout-layout`, children: [
                    (0, jsxRuntime.jsxs)(`aside`, {
                        className: `pd-sidebar`, children: [
                            (0, jsxRuntime.jsx)(`p`, {
                                className: `pd-kicker`, children: `Made for your day`
                            }), (0, jsxRuntime.jsx)(`h3`, {
                                id: headingId, children: state.step === `intake` ? `Your time.
Your focus.` : workout?.title
                            }), (0, jsxRuntime.jsx)(`ol`, {
                                className: `pd-steps`, "aria-label": `Workout creation progress`, children: stepLabels.map((e, t) => (0, jsxRuntime.jsxs)(`li`, {
                                    "data-current": activeStep === t, "data-complete": activeStep > t, "aria-current": activeStep === t ? `step` : void 0, children: [
                                        (0, jsxRuntime.jsx)(`span`, {
                                            children: activeStep > t ? (0, jsxRuntime.jsx)(CheckIcon, {}) : `0${t + 1}`
                                        }), e
                                    ]
                                }, e))
                            }), (0, jsxRuntime.jsxs)(`div`, {
                                className: `pd-plan-context`, children: [
                                    (0, jsxRuntime.jsx)(`span`, {
                                        className: `pd-tiny-label`, children: `Sample training focus`
                                    }), (0, jsxRuntime.jsx)(`strong`, {
                                        children: focusContext
                                    }), (0, jsxRuntime.jsx)(`span`, {
                                        children: `One session · Two guided drills`
                                    })
                                ]
                            }), (0, jsxRuntime.jsx)(`p`, {
                                className: `pd-demo-note`, children: `Explore a sample workout at your own pace.`
                            })
                        ]
                    }), (0, jsxRuntime.jsxs)(`div`, {
                        className: `pd-workout-main`, children: [
                            state.step === `intake` && (0, jsxRuntime.jsxs)(BlurFade, {
                                duration: .25, blur: `3px`, children: [
                                    (0, jsxRuntime.jsxs)(`div`, {
                                        className: `pd-heading`, children: [
                                            (0, jsxRuntime.jsxs)(`div`, {
                                                children: [
                                                    (0, jsxRuntime.jsx)(`span`, {
                                                        className: `pd-tiny-label`, children: `Create your workout`
                                                    }), (0, jsxRuntime.jsx)(`h4`, {
                                                        tabIndex: -1, children: choosingFocus ? `What do you want to work on?` : `What works for you today?`
                                                    })
                                                ]
                                            }), (0, jsxRuntime.jsx)(`span`, {
                                                className: `pd-step-index`, children: choosingFocus ? `02 / 02` : `01 / 02`
                                            })
                                        ]
                                    }), initialRequest && (0, jsxRuntime.jsxs)(`div`, {
                                        className: `pd-handoff`, children: [
                                            (0, jsxRuntime.jsx)(TacticalIcon, {
                                                kind: `control`
                                            }), (0, jsxRuntime.jsxs)(`span`, {
                                                children: [
                                                    `From the AI Coach sample: `,
                                                    initialRequest
                                                ]
                                            })
                                        ]
                                    }), (0, jsxRuntime.jsxs)(`form`, {
                                        className: `pd-intake`, onSubmit: e => {
                                            e.preventDefault();
                                            if (choosingFocus) {
                                                transition({
                                                    type: `prepare`, choices: choices
                                                });
                                            }
                                            else {
                                                setFocusStep(true);
                                            }
                                        }, children: [
                                            choosingFocus ? (0, jsxRuntime.jsxs)(jsxRuntime.Fragment, {
                                                children: [
                                                    (0, jsxRuntime.jsxs)(`fieldset`, {
                                                        children: [
                                                            (0, jsxRuntime.jsx)(`legend`, {
                                                                children: `Choose your priority`
                                                            }), (0, jsxRuntime.jsx)(`div`, {
                                                                className: `pd-options pd-focus`, children: [`dribbling`, `passing`].map(e => (0, jsxRuntime.jsx)(`button`, {
                                                                    type: `button`, "aria-pressed": choices.focus === e, onClick: () => updateChoice(`focus`, e), children: e
                                                                }, e))
                                                            })
                                                        ]
                                                    }), (0, jsxRuntime.jsx)(DemoPitch, {
                                                        focus: choices.focus, className: `pd-focus-preview`
                                                    }), (0, jsxRuntime.jsxs)(`p`, {
                                                        className: `pd-focus-request`, children: [
                                                            `“`, choices.minutes, ` minutes available for `, choices.focus, `, with `, choices.energy === `low` ? `low` : choices.energy === `high` ? `high` : `normal`, ` energy today.”`
                                                        ]
                                                    })
                                                ]
                                            }) : (0, jsxRuntime.jsxs)(jsxRuntime.Fragment, {
                                                children: [
                                                    (0, jsxRuntime.jsxs)(`fieldset`, {
                                                        children: [
                                                            (0, jsxRuntime.jsx)(`legend`, {
                                                                children: `How much time do you have?`
                                                            }), (0, jsxRuntime.jsx)(`div`, {
                                                                className: `pd-options`, children: (initialRequest ? [15, 20, 30, 45, 60] : [15, 30, 45, 60]).map(e => (0, jsxRuntime.jsxs)(`button`, {
                                                                    type: `button`, "aria-pressed": choices.minutes === e, onClick: () => updateChoice(`minutes`, e), children: [
                                                                        (0, jsxRuntime.jsx)(`strong`, {
                                                                            children: e
                                                                        }), (0, jsxRuntime.jsx)(`span`, {
                                                                            children: `min`
                                                                        })
                                                                    ]
                                                                }, e))
                                                            })
                                                        ]
                                                    }), (0, jsxRuntime.jsxs)(`fieldset`, {
                                                        children: [
                                                            (0, jsxRuntime.jsx)(`legend`, {
                                                                children: `How’s your energy?`
                                                            }), (0, jsxRuntime.jsx)(`div`, {
                                                                className: `pd-options pd-energy`, children: [`low`, `normal`, `high`].map((e, t) => (0, jsxRuntime.jsxs)(`button`, {
                                                                    type: `button`, "aria-pressed": choices.energy === e, onClick: () => updateChoice(`energy`, e), children: [
                                                                        (0, jsxRuntime.jsx)(`span`, {
                                                                            className: `pd-energy-bars`, "aria-hidden": `true`, children: [0, 1, 2].map(e => (0, jsxRuntime.jsx)(`i`, {
                                                                                "data-on": e <= t
                                                                            }, e))
                                                                        }), (0, jsxRuntime.jsxs)(`span`, {
                                                                            children: [
                                                                                (0, jsxRuntime.jsx)(`strong`, {
                                                                                    children: [`Running on empty`, `Normal`, `Fresh`][t]
                                                                                }), (0, jsxRuntime.jsx)(`small`, {
                                                                                    children: [`Technique over intensity`, `A standard session`, `Ready for quality work`][t]
                                                                                })
                                                                            ]
                                                                        })
                                                                    ]
                                                                }, e))
                                                            })
                                                        ]
                                                    })
                                                ]
                                            }), (0, jsxRuntime.jsxs)(`button`, {
                                                type: `submit`, className: `pd-primary`, children: [
                                                    choosingFocus ? `Create sample workout` : `Choose your focus`, (0, jsxRuntime.jsx)(TacticalIcon, {
                                                        kind: `next`
                                                    })
                                                ]
                                            }), choosingFocus && (0, jsxRuntime.jsx)(`button`, {
                                                type: `button`, className: `pd-text-button pd-back-choice`, onClick: () => setFocusStep(false), children: `Change time and energy`
                                            })
                                        ]
                                    })
                                ]
                            }, `intake`), state.step === `preparing` && workout && (0, jsxRuntime.jsxs)(`div`, {
                                className: `pd-preparing`, role: `status`, "aria-label": `Preparing your sample workout`, children: [
                                    (0, jsxRuntime.jsx)(`span`, {
                                        className: `pd-tiny-label`, children: `Your choices, coming together`
                                    }), (0, jsxRuntime.jsx)(`h4`, {
                                        children: `Building your sample.`
                                    }), (0, jsxRuntime.jsxs)(`p`, {
                                        children: [
                                            workout.choices.minutes, ` minutes available · `, workout.choices.focus
                                        ]
                                    }), (0, jsxRuntime.jsx)(DemoPitch, {
                                        focus: workout.choices.focus
                                    }), (0, jsxRuntime.jsx)(`ol`, {
                                                        children: [`Order your two drills`, `Balance the work and rest`, `Prepare the instructions`].map((e, t) => (0, jsxRuntime.jsxs)(`li`, {
                                            "data-complete": preparationStep > t, children: [
                                                (0, jsxRuntime.jsx)(`span`, {
                                                    children: preparationStep > t ? (0, jsxRuntime.jsx)(CheckIcon, {}) : `0${t + 1}`
                                                }), e
                                            ]
                                        }, e))
                                    }), (0, jsxRuntime.jsx)(`div`, {
                                        className: `pd-build-progress`, children: (0, jsxRuntime.jsx)(`i`, {
                                            style: {
                                                width: `${preparationStep / 3 * 100}%`
                                            }
                                        })
                                    }), (0, jsxRuntime.jsx)(`p`, {
                                        className: `pd-demo-note`, children: `A sample session built around your choices.`
                                    })
                                ]
                            }), state.step === `review` && workout && (0, jsxRuntime.jsxs)(BlurFade, {
                                duration: .3, blur: `4px`, children: [
                                    (0, jsxRuntime.jsxs)(`div`, {
                                        className: `pd-heading`, children: [
                                            (0, jsxRuntime.jsxs)(`div`, {
                                                children: [
                                                    (0, jsxRuntime.jsx)(`span`, {
                                                        className: `pd-tiny-label`, children: `Two-drill sample · ready to review`
                                                    }), (0, jsxRuntime.jsx)(`h4`, {
                                                        tabIndex: -1, children: workout.title
                                                    })
                                                ]
                                            }), (0, jsxRuntime.jsx)(`span`, {
                                                className: `pd-ready`, children: (0, jsxRuntime.jsx)(CheckIcon, {})
                                            })
                                        ]
                                    }), (0, jsxRuntime.jsx)(`p`, {
                                        className: `pd-intent`, children: workout.intent
                                    }), (0, jsxRuntime.jsxs)(`div`, {
                                        className: `pd-workout-tags`, children: [
                                            (0, jsxRuntime.jsxs)(`span`, {
                                                className: `pd-duration-tag`, children: [
                                                    formatDuration(workout.durationSeconds), ` work + rest`
                                                ]
                                            }), (0, jsxRuntime.jsxs)(`span`, {
                                                children: [
                                                    workout.choices.minutes, ` min available`
                                                ]
                                            }), (0, jsxRuntime.jsxs)(`span`, {
                                                children: [
                                                    workout.choices.energy, ` energy`
                                                ]
                                            })
                                        ]
                                    }), (0, jsxRuntime.jsx)(DrillMedia, { drillId: workout.drills[Math.min(selectedDrillIndex, workout.drills.length - 1)].id, active }), (0, jsxRuntime.jsx)(`div`, {
                                        className: `pd-proposal-list`, children: workout.drills.map((e, t) => (0, jsxRuntime.jsx)(MagicCard, {
                                            className: `pd-drill-card`, gradientFrom: `#b7f34a`, gradientTo: `#4bd7e8`, gradientColor: `#b7f34a12`, gradientOpacity: .4, children: (0, jsxRuntime.jsxs)(`div`, {
                                                className: `pd-drill-row`, children: [
                                                    (0, jsxRuntime.jsx)(`button`, { type: `button`, className: `pd-drill-select`, "aria-label": `View ${e.title || e.name}`, "aria-pressed": selectedDrillIndex === t, onClick: () => setSelectedDrillIndex(t), children: `View drill` }),
                                                    (0, jsxRuntime.jsxs)(`span`, {
                                                        className: `pd-drill-order`, children: [
                                                            `0`, t + 1
                                                        ]
                                                    }), (0, jsxRuntime.jsxs)(`div`, {
                                                        children: [
                                                            (0, jsxRuntime.jsx)(`strong`, {
                                                                children: e.name
                                                            }), (0, jsxRuntime.jsxs)(`span`, {
                                                                children: [
                                                                    formatDose(e), ` · `, e.restSeconds, ` sec rest`
                                                                ]
                                                            }), (0, jsxRuntime.jsx)(`p`, { className: `pd-drill-setup`, children: e.setup })
                                                        ]
                                                    }), (0, jsxRuntime.jsx)(TacticalIcon, {
                                                        kind: e.focus === `dribbling` ? `control` : `cut`
                                                    })
                                                ]
                                            })
                                        }, e.id))
                                    }), (0, jsxRuntime.jsx)(`p`, {
                                        className: `pd-small-copy`, children: `A short sample that fits your time. Warm-up, setup, and cooldown are additional.`
                                    }), (0, jsxRuntime.jsxs)(`div`, {
                                        className: `pd-actions`, children: [
                                            (0, jsxRuntime.jsxs)(`button`, {
                                                type: `button`, className: `pd-primary`, onClick: () => transition({
                                                    type: `start`
                                                }), children: [
                                                    `Start sample workout`, (0, jsxRuntime.jsx)(TacticalIcon, {
                                                        kind: `play`
                                                    })
                                                ]
                                            }), (0, jsxRuntime.jsx)(`button`, {
                                                type: `button`, className: `pd-text-button`, onClick: () => {
                                                    setChoosingFocus(false);
                                                    transition({
                                                        type: `edit`
                                                    });
                                                }, children: `Customize`
                                            })
                                        ]
                                    }), (0, jsxRuntime.jsx)(`p`, {
                                        className: `pd-demo-note`, children: `Try the sample session, one set at a time.`
                                    })
                                ]
                            }, `review`), state.step === `training` && workout && currentSegment && currentDrill && (0, jsxRuntime.jsxs)(`div`, {
                                className: `pd-training`, children: [
                                    (0, jsxRuntime.jsxs)(`div`, {
                                        className: `pd-heading`, children: [
                                            (0, jsxRuntime.jsxs)(`div`, {
                                                children: [
                                                    (0, jsxRuntime.jsxs)(`span`, {
                                                        className: `pd-tiny-label`, children: [
                                                            `Drill `, currentSegment.drill + 1, ` / `, workout.drills.length, ` · `, formatDose(currentDrill)
                                                        ]
                                                    }), (0, jsxRuntime.jsx)(`h4`, {
                                                        tabIndex: -1, children: currentDrill.name
                                                    })
                                                ]
                                            }), (0, jsxRuntime.jsx)(`button`, {
                                                type: `button`, className: `pd-icon-button`, "aria-label": state.paused ? `Resume workout timer` : `Pause workout timer`, onClick: () => dispatch({
                                                    type: `pause`
                                                }), children: (0, jsxRuntime.jsx)(TacticalIcon, {
                                                    kind: state.paused ? `play` : `pause`
                                                })
                                            })
                                        ]
                                    }), (0, jsxRuntime.jsxs)(`div`, {
                                        className: `pd-session-scene`, children: [
                                            (0, jsxRuntime.jsx)(DrillMedia, {
                                                drillId: currentDrill.id, active
                                            }), (0, jsxRuntime.jsxs)(`div`, {
                                                className: `pd-timer`, style: {
                                                    "--timer-progress": currentSegment.seconds ? state.remaining / currentSegment.seconds : 0
                                                }, children: [
                                                    (0, jsxRuntime.jsxs)(`svg`, {
                                                        viewBox: `0 0 120 120`, "aria-hidden": `true`, children: [
                                                            (0, jsxRuntime.jsx)(`circle`, {
                                                                className: `pd-timer-track`, cx: `60`, cy: `60`, r: `53`
                                                            }), (0, jsxRuntime.jsx)(`circle`, {
                                                                className: `pd-timer-progress`, cx: `60`, cy: `60`, r: `53`, pathLength: `1`
                                                            })
                                                        ]
                                                    }), (0, jsxRuntime.jsxs)(`div`, {
                                                        children: [
                                                            (0, jsxRuntime.jsx)(`span`, {
                                                                children: state.paused ? `Paused` : currentSegment.kind === `rest` ? `Recover` : state.remaining === 0 ? `Set ready` : `Working`
                                                            }), (0, jsxRuntime.jsx)(`strong`, {
                                                                role: `timer`, "aria-label": `${Math.ceil(state.remaining)} seconds remaining`, children: formatDuration(state.remaining)
                                                            }), (0, jsxRuntime.jsxs)(`small`, {
                                                                children: [
                                                                    `Set `, currentSegment.set, ` / `, currentDrill.sets
                                                                ]
                                                            })
                                                        ]
                                                    })
                                                ]
                                            })
                                        ]
                                    }), (0, jsxRuntime.jsxs)(`div`, {
                                        className: `pd-coaching-cue`, children: [
                                            (0, jsxRuntime.jsx)(`span`, {
                                                className: `pd-tiny-label`, children: currentSegment.kind === `rest` ? `Reset for the next set` : `How to do it`
                                            }), (0, jsxRuntime.jsx)(`p`, {
                                                children: currentSegment.kind === `rest` ? currentDrill.cue : currentDrill.instruction
                                            })
                                        ]
                                    }), (0, jsxRuntime.jsxs)(`div`, {
                                        className: `pd-session-progress`, children: [
                                            (0, jsxRuntime.jsxs)(`span`, {
                                                children: [
                                                    state.completedSets, ` / `,
                                                    totalSets,
                                                    ` sets completed`
                                                ]
                                            }), (0, jsxRuntime.jsx)(`div`, {
                                                children: Array.from({
                                                    length: totalSets
                                                }, (e, t) => (0, jsxRuntime.jsx)(`i`, {
                                                    "data-complete": t < state.completedSets
                                                }, t))
                                            })
                                        ]
                                    }), (0, jsxRuntime.jsxs)(`div`, {
                                        className: `pd-actions`, children: [
                                            (0, jsxRuntime.jsxs)(`button`, {
                                                type: `button`, className: `pd-primary`, onClick: () => state.segment === workout.segments.length - 1 ? transition({
                                                    type: `advance`
                                                }) : dispatch({
                                                    type: `advance`
                                                }), children: [
                                                    currentSegment.kind === `rest` ? `Skip rest` : `Complete set ${currentSegment.set}`, (0, jsxRuntime.jsx)(TacticalIcon, {
                                                        kind: `next`
                                                    })
                                                ]
                                            }), (0, jsxRuntime.jsx)(`button`, {
                                                type: `button`, className: `pd-text-button`, onClick: () => transition({
                                                    type: `finishDemo`
                                                }), children: `Skip ahead to summary`
                                            })
                                        ]
                                    }), (0, jsxRuntime.jsx)(`p`, {
                                        className: `pd-demo-note`, children: `Work through the timer or skip ahead to explore.`
                                    })
                                ]
                            }), state.step === `summary` && workout && (0, jsxRuntime.jsxs)(BlurFade, {
                                duration: .3, children: [
                                    (0, jsxRuntime.jsxs)(`div`, {
                                        className: `pd-heading`, children: [
                                            (0, jsxRuntime.jsxs)(`div`, {
                                                children: [
                                                    (0, jsxRuntime.jsx)(`span`, {
                                                        className: `pd-tiny-label`, children: `Your sample session`
                                                    }), (0, jsxRuntime.jsx)(`h4`, {
                                                        tabIndex: -1, children: `See the work add up.`
                                                    })
                                                ]
                                            }), (0, jsxRuntime.jsx)(`span`, {
                                                className: `pd-ready`, children: (0, jsxRuntime.jsx)(CheckIcon, {})
                                            })
                                        ]
                                    }), (0, jsxRuntime.jsxs)(`div`, {
                                        className: `pd-summary-stats`, children: [
                                            (0, jsxRuntime.jsxs)(`div`, {
                                                children: [
                                                    (0, jsxRuntime.jsxs)(`strong`, {
                                                        children: [
                                                            state.completedSets, (0, jsxRuntime.jsxs)(`small`, {
                                                                children: [
                                                                    ` / `,
                                                                    totalSets
                                                                ]
                                                            })
                                                        ]
                                                    }), (0, jsxRuntime.jsx)(`span`, {
                                                        children: `sets explored`
                                                    })
                                                ]
                                            }), (0, jsxRuntime.jsxs)(`div`, {
                                                children: [
                                                    (0, jsxRuntime.jsx)(`strong`, {
                                                        children: workout.drills.length
                                                    }), (0, jsxRuntime.jsx)(`span`, {
                                                        children: `drills in this sample`
                                                    })
                                                ]
                                            }), (0, jsxRuntime.jsxs)(`div`, {
                                                children: [
                                                    (0, jsxRuntime.jsx)(`strong`, {
                                                        children: formatDuration(state.elapsed)
                                                    }), (0, jsxRuntime.jsx)(`span`, {
                                                        children: `demo timer elapsed`
                                                    })
                                                ]
                                            })
                                        ]
                                    }), (0, jsxRuntime.jsx)(`div`, {
                                        className: `pd-summary-drills`, children: workout.drills.map(e => (0, jsxRuntime.jsxs)(`div`, {
                                            children: [
                                                (0, jsxRuntime.jsx)(`span`, {
                                                    className: `pd-check`, children: (0, jsxRuntime.jsx)(CheckIcon, {})
                                                }), (0, jsxRuntime.jsxs)(`span`, {
                                                    children: [
                                                        (0, jsxRuntime.jsx)(`strong`, {
                                                            children: e.name
                                                        }), (0, jsxRuntime.jsx)(`small`, {
                                                            children: formatDose(e)
                                                        })
                                                    ]
                                                }), (0, jsxRuntime.jsx)(`span`, {
                                                    children: state.skippedTime ? `Reviewed` : `Demo complete`
                                                })
                                            ]
                                        }, e.id))
                                    }), (0, jsxRuntime.jsxs)(`div`, {
                                        className: `pd-finish-note`, children: [
                                            (0, jsxRuntime.jsx)(TacticalIcon, {
                                                kind: `retest`
                                            }), (0, jsxRuntime.jsx)(`p`, {
                                                children: `Review the drills, then build your next sample around what you want to practice.`
                                            })
                                        ]
                                    }), (0, jsxRuntime.jsxs)(`button`, {
                                        type: `button`, className: `pd-primary`, onClick: () => {
                                            setChoosingFocus(false);
                                            transition({
                                                type: `reset`
                                            });
                                        }, children: [
                                            `Build another sample`, (0, jsxRuntime.jsx)(TacticalIcon, {
                                                kind: `next`
                                            })
                                        ]
                                    }), (0, jsxRuntime.jsx)(`p`, {
                                        className: `pd-demo-note`, children: state.skippedTime ? `You skipped ahead in this sample session.` : `Sample session complete.`
                                    })
                                ]
                            }, `summary`)
                        ]
                    })
                ]
            }), (0, jsxRuntime.jsxs)(`div`, {
                className: `pd-bottom-bar`, children: [
                    (0, jsxRuntime.jsx)(`span`, {
                        className: `pd-status-dot`
                    }), state.step === `intake` ? `Start with the time and energy you have.` : `${focus.charAt(0).toUpperCase() + focus.slice(1)} · ${formatDuration(workout?.durationSeconds || 0)} sample · ${workout?.choices.minutes} min available`, (0, jsxRuntime.jsx)(`span`, {
                        children: `PLAN → TRAIN → PROGRESS`
                    })
                ]
            })
        ]
    });
}

export { DemoPitch, WorkoutDemo as default };
