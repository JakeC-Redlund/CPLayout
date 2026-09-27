const assert = require("node:assert/strict");
const { validateSkillContent } = require("./validateCplayoutSkillFrontmatter.cjs");

const skill = (frontmatter, body = "# Skill\n") => `---\n${frontmatter}\n---\n${body}`;
const valid = "name: cplayout-test\ndescription: A valid local test skill.";

assert.equal(validateSkillContent(skill(valid)).ok, true);
assert.equal(validateSkillContent("# No frontmatter").ok, false);
assert.equal(validateSkillContent(skill(`${valid}\nname: duplicate`)).ok, false);
assert.equal(validateSkillContent(skill("name: bad_name\ndescription: A skill.")).ok, false);
assert.equal(validateSkillContent(skill("name: cplayout-test\ndescription: ''")).ok, false);
assert.equal(validateSkillContent(skill('name: cplayout-test\ndescription: "  [TODO: finish]"')).ok, false);
assert.equal(validateSkillContent(skill(`${valid}\nunexpected: true`)).ok, false);
assert.equal(validateSkillContent(skill(valid, "[TODO: finish this]\n")).ok, false);
assert.equal(validateSkillContent(skill(valid, "```text\n[TODO: example]\n```\n")).ok, true);
assert.equal(validateSkillContent(skill("name: [unterminated\ndescription: bad")).ok, false);

console.log("repo-local skill frontmatter validator tests passed");
