/**
 * Recovered from CoachDemo-B4XwZJSc.js, deployment 6aa9b6f0d8faf6177db8fd97.
 * See RECOVERY.md. JSX-runtime calls preserve the published element tree.
 */
import * as React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { BlurFade } from "../../../components/magicui/blur-fade";
import { TacticalIcon } from "../TacticalIcon";
import { sampleAthlete, coachWorkoutRequest, coachQuestions } from "./product-demo";
import "./product-demo.css";
function CoachDemo({ active = true, onOpenWorkout }) {
    let [selectedQuestion, setSelectedQuestion] = (0, React.useState)(0);
    let [visibleWords, setVisibleWords] = (0, React.useState)(1 / 0);
    let [hasInteracted, setHasInteracted] = (0, React.useState)(false);
    let [documentVisible, setDocumentVisible] = (0, React.useState)(true);
    let headingId = (0, React.useId)();
    let question = coachQuestions[selectedQuestion];
    let answerWords = question.answer.split(` `);
    return (0, React.useEffect)(() => {
        let e = () => setDocumentVisible(!document.hidden);
        return e(), document.addEventListener(`visibilitychange`, e), () => document.removeEventListener(`visibilitychange`, e);
    }, []), (0, React.useEffect)(() => {
        if (!hasInteracted)
            return;
        let e = window.matchMedia(`(prefers-reduced-motion: reduce)`).matches;
        setVisibleWords(e ? 1 / 0 : 0);
    }, [selectedQuestion, hasInteracted]), (0, React.useEffect)(() => {
        if (!active || !documentVisible || visibleWords >= answerWords.length)
            return;
        let t = window.setInterval(() => setVisibleWords(e => e + 2), 45);
        return () => window.clearInterval(t);
    }, [active, documentVisible, visibleWords, answerWords.length]), (0, jsxRuntime.jsxs)(`div`, {
        className: `product-demo coach-demo`, "aria-labelledby": headingId, children: [
            (0, jsxRuntime.jsxs)(`div`, {
                className: `pd-topbar`, children: [
                    (0, jsxRuntime.jsx)(`span`, {
                        className: `pd-appmark`, "aria-hidden": `true`, children: `P`
                    }), (0, jsxRuntime.jsx)(`span`, {
                        children: `AI Coach`
                    }), (0, jsxRuntime.jsx)(`span`, {
                        className: `pd-sample-label`, children: `Interactive demo`
                    })
                ]
            }), (0, jsxRuntime.jsxs)(`div`, {
                className: `pd-coach-layout`, children: [
                    (0, jsxRuntime.jsxs)(`aside`, {
                        className: `pd-profile`, children: [
                            (0, jsxRuntime.jsxs)(`div`, {
                                className: `pd-athlete`, children: [
                                    (0, jsxRuntime.jsx)(`span`, {
                                        className: `pd-avatar`, children: sampleAthlete.initials
                                    }), (0, jsxRuntime.jsxs)(`div`, {
                                        children: [
                                            (0, jsxRuntime.jsx)(`strong`, {
                                                children: sampleAthlete.name
                                            }), (0, jsxRuntime.jsxs)(`span`, {
                                                children: [
                                                    sampleAthlete.role, ` · Sample athlete`
                                                ]
                                            })
                                        ]
                                    })
                                ]
                            }), (0, jsxRuntime.jsx)(`p`, {
                                className: `pd-tiny-label`, children: `The profile behind the answer`
                            }), (0, jsxRuntime.jsx)(`div`, {
                                className: `pd-metrics`, children: sampleAthlete.metrics.map(e => {
                                    let t = Math.min(...e.values);
                                    let n = Math.max(...e.values);
                                    let r = e.values.map((e, r) => `${4 + r * 25},${34 - (e - t) / Math.max(n - t, 1e-6) * 26}`).join(` `);
                                    return (0, jsxRuntime.jsxs)(`div`, {
                                        className: `pd-profile-metric`, "data-highlighted": e.key === question.metric, children: [
                                            (0, jsxRuntime.jsxs)(`div`, {
                                                children: [
                                                    (0, jsxRuntime.jsx)(`span`, {
                                                        children: e.label
                                                    }), (0, jsxRuntime.jsxs)(`strong`, {
                                                        children: [
                                                            e.value, (0, jsxRuntime.jsx)(`small`, {
                                                                children: e.unit
                                                            })
                                                        ]
                                                    }), (0, jsxRuntime.jsx)(`em`, {
                                                        children: e.trend
                                                    })
                                                ]
                                            }), (0, jsxRuntime.jsxs)(`svg`, {
                                                viewBox: `0 0 84 40`, className: `pd-sparkline`, "aria-hidden": `true`, children: [
                                                    (0, jsxRuntime.jsx)(`path`, {
                                                        d: `M4 36h75`, className: `pd-chart-baseline`
                                                    }), (0, jsxRuntime.jsx)(`polyline`, {
                                                        points: r
                                                    }), e.values.map((e, r) => (0, jsxRuntime.jsx)(`circle`, {
                                                        cx: 4 + r * 25, cy: 34 - (e - t) / Math.max(n - t, 1e-6) * 26, r: r === 3 ? 3 : 1.5
                                                    }, r))
                                                ]
                                            })
                                        ]
                                    }, e.key);
                                })
                            }), (0, jsxRuntime.jsxs)(`div`, {
                                className: `pd-context-chip`, children: [
                                    (0, jsxRuntime.jsx)(`span`, {
                                        className: `pd-status-dot`
                                    }), (0, jsxRuntime.jsx)(`span`, {
                                        children: sampleAthlete.week
                                    })
                                ]
                            })
                        ]
                    }), (0, jsxRuntime.jsxs)(`div`, {
                        className: `pd-conversation`, children: [
                            (0, jsxRuntime.jsxs)(`div`, {
                                className: `pd-heading`, children: [
                                    (0, jsxRuntime.jsxs)(`div`, {
                                        children: [
                                            (0, jsxRuntime.jsx)(`span`, {
                                                className: `pd-tiny-label`, children: `Your results. In context.`
                                            }), (0, jsxRuntime.jsx)(`h3`, {
                                                id: headingId, children: `Ask a better next question.`
                                            })
                                        ]
                                    }), (0, jsxRuntime.jsx)(`span`, {
                                        className: `pd-coach-symbol`, children: (0, jsxRuntime.jsx)(TacticalIcon, {
                                            kind: `explore`
                                        })
                                    })
                                ]
                            }), (0, jsxRuntime.jsx)(`div`, {
                                className: `pd-question-chips`, "aria-label": `Sample questions`, children: coachQuestions.map((e, t) => (0, jsxRuntime.jsx)(`button`, {
                                    type: `button`, "aria-pressed": t === selectedQuestion, onClick: () => {
                                        setSelectedQuestion(t);
                                        setHasInteracted(true);
                                    }, children: e.question
                                }, e.id))
                            }), (0, jsxRuntime.jsxs)(`div`, {
                                className: `pd-chat-thread`, children: [
                                    (0, jsxRuntime.jsxs)(`div`, {
                                        className: `pd-user-message`, children: [
                                            (0, jsxRuntime.jsx)(`span`, {
                                                children: `You`
                                            }), (0, jsxRuntime.jsx)(`p`, {
                                                children: question.question
                                            })
                                        ]
                                    }), (0, jsxRuntime.jsx)(BlurFade, {
                                        duration: .22, offset: 4, blur: `2px`, children: (0, jsxRuntime.jsxs)(`article`, {
                                            className: `pd-coach-answer`, "aria-live": `polite`, "aria-atomic": `true`, children: [
                                                (0, jsxRuntime.jsxs)(`div`, {
                                                    className: `pd-answer-author`, children: [
                                                        (0, jsxRuntime.jsx)(`span`, {
                                                            className: `pd-appmark`, "aria-hidden": `true`, children: `P`
                                                        }), `PoseTek coach`, (0, jsxRuntime.jsx)(`span`, {
                                                            children: `Sample answer`
                                                        })
                                                    ]
                                                }), (0, jsxRuntime.jsx)(`h4`, {
                                                    children: question.title
                                                }), (0, jsxRuntime.jsxs)(`p`, {
                                                    children: [
                                                        (0, jsxRuntime.jsx)(`span`, {
                                                            className: `pd-sr-only`, children: question.answer
                                                        }), (0, jsxRuntime.jsxs)(`span`, {
                                                            "aria-hidden": `true`, children: [
                                                                answerWords.slice(0, visibleWords).join(` `), visibleWords < answerWords.length && (0, jsxRuntime.jsx)(`i`, {
                                                                    className: `pd-caret`
                                                                })
                                                            ]
                                                        })
                                                    ]
                                                }), (0, jsxRuntime.jsxs)(`div`, {
                                                    className: `pd-evidence`, children: [
                                                        (0, jsxRuntime.jsx)(TacticalIcon, {
                                                            kind: `explore`
                                                        }), question.evidence
                                                    ]
                                                })
                                            ]
                                        })
                                    }, question.id)
                                ]
                            }), (0, jsxRuntime.jsxs)(`button`, {
                                type: `button`, className: `pd-workout-handoff`, onClick: () => onOpenWorkout(coachWorkoutRequest), children: [
                                    (0, jsxRuntime.jsxs)(`span`, {
                                        children: [
                                            (0, jsxRuntime.jsx)(`small`, {
                                                children: `Take it into training`
                                            }), (0, jsxRuntime.jsx)(`strong`, {
                                                children: `Help me plan 20 minutes`
                                            })
                                        ]
                                    }), (0, jsxRuntime.jsx)(TacticalIcon, {
                                        kind: `next`
                                    })
                                ]
                            }), (0, jsxRuntime.jsx)(`p`, {
                                className: `pd-demo-note`, children: `Explore a sample profile, then take the next step into training.`
                            })
                        ]
                    })
                ]
            }), (0, jsxRuntime.jsxs)(`div`, {
                className: `pd-bottom-bar`, children: [
                    (0, jsxRuntime.jsx)(`span`, {
                        className: `pd-status-dot`
                    }), `From a result to a useful next step.`, (0, jsxRuntime.jsx)(`span`, {
                        children: `PROFILE → CONTEXT → ACTION`
                    })
                ]
            })
        ]
    });
}

export default CoachDemo;
