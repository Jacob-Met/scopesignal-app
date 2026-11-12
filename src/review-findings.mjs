// Generated file identity is useful evidence context, not an authored observation.
// This deliberately does not assess the truth or quality of the remaining prose.
export function hasAuthoredFindings(value) {
 if (typeof value !== 'string') return false;
 const generated = /(?:^|\n)File reviewed: [\s\S]*? \(\d+ bytes; SHA-256 [a-f0-9]{64}\)\.(?=\s*(?:\n|$))/g;
 return value.replace(generated, '').trim().length > 0;
}
