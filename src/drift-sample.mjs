// Canned data for trying scope watch without any keys or model.
export const SAMPLE_PROJECT = {
  label: 'Harbor Lane Bakery rebrand',
  brief: 'Harbor Lane Bakery is reopening on December 5 and needs a new identity. We need a logo with a one-colour version for stamps, a printed menu for the counter, and a painted sign for the front window. Everything has to be ready for print a week before opening.',
  cap: '2400',
  checkpoints: [
    { title: 'Logo design and approval', amount: '800', evidence: 'Ready when the owner has approved one primary logo and a one-colour version that works for stamps.' },
    { title: 'Printed counter menu', amount: '900', evidence: 'Ready when a print-ready menu PDF is delivered and the owner has approved it.' },
    { title: 'Painted window sign', amount: '700', evidence: 'Ready when the sign artwork is approved and handed to the painter at least a week before opening.' },
  ],
};
export const SAMPLE_THREAD = [
  '[09:12] Mara: Hi! Just saw the first logo round. I love the wheat mark.',
  '[09:13] Mara: The one-colour version for the stamp works great too.',
  '[09:20] You: Glad to hear it. The menu draft goes out Thursday.',
  '[09:41] Mara: Perfect. Oh, and could you also design a shopfront banner for opening weekend? Same style as the sign.',
  '[09:44] You: Sure, I can look at that.',
  '[10:02] Mara: We would love a set of three Instagram posts announcing the reopening too.',
  '[10:30] Mara: Also can you make the logo a bit bigger on the window sign?',
  '[11:05] Mara: One more thing. What about packaging stickers for the pastry boxes?',
  '[11:06] Mara: Thanks, talk Friday!',
].join('\n');
