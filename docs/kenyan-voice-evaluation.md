# Kenyan voice evaluation

Use the same consented recordings with the original International English profile and the Kenyan English profile. Keep source audio and transcripts out of Git. Record model, locale, device, noise condition, response latency and error type. Do not use actual credentials, account numbers or private conversations.

| Utterance | Expected interpretation |
| --- | --- |
| Niaje NEON? | Casual greeting, not a name |
| Si you explain it again? | Request to repeat an explanation |
| Niko kwa mat, I'll call later | On a matatu in context |
| I have five thao | KES 5,000 if the meaning is clear |
| What does a SACCO do? | Kenyan cooperative context |
| How do I get to Eldama Ravine? | Preserve the place name |
| I meant fifteen, not fifty bob | Preserve the correction and negation |
| Naomba unieleze jinsi ya kujiunga na chama | Kiswahili input; reply in English in experimental profile |
| Please give me a professional explanation | Formal register without forced slang |

Test speakers from diverse Kenyan English backgrounds, clean and noisy conditions. Measure word error rate, local entity accuracy, monetary amount exact match, intent accuracy, interruption handling and end-of-turn to first audio latency. Blind-rate spoken accent authenticity and naturalness separately. No baseline or performance claim is made until measured.

Manual smoke test: select each profile, start with microphone permission, check SettingsApplied/listening, ask a question, interrupt playback, request a comparison that renders a visual scene, end session, change profile, restart, reload and verify preference. Check recovery from rejected settings, microphone denial and network loss. Verify persisted turns retain provider transcripts.
