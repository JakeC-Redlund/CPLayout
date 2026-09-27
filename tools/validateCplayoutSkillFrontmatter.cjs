#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const YAML = require("yaml");

const ALLOWED_KEYS = new Set(["name", "description", "license", "allowed-tools", "metadata"]);

function validateSkillContent(content) {
  const lines = content.split(/\r?\n/);
  if (lines[0] !== "---") return { ok: false, message: "No YAML frontmatter found" };
  const end = lines.indexOf("---", 1);
  if (end < 0) return { ok: false, message: "Invalid frontmatter format" };

  const doc = YAML.parseDocument(lines.slice(1, end).join("\n"), { uniqueKeys: true, stringKeys: true });
  if (doc.errors.length) return { ok: false, message: `Invalid YAML in frontmatter: ${doc.errors[0].message}` };
  const frontmatter = doc.toJS();
  if (!frontmatter || typeof frontmatter !== "object" || Array.isArray(frontmatter)) {
    return { ok: false, message: "Frontmatter must be a YAML mapping" };
  }
  const unexpected = Object.keys(frontmatter).filter((key) => !ALLOWED_KEYS.has(key));
  if (unexpected.length) return { ok: false, message: `Unexpected frontmatter keys: ${unexpected.join(", ")}` };

  const name = frontmatter.name;
  if (typeof name !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name) || name.length > 64) {
    return { ok: false, message: "Name must be 1-64 lowercase hyphen-case characters" };
  }
  const description = frontmatter.description;
  const normalizedDescription = typeof description === "string" ? description.trim() : "";
  if (!normalizedDescription || normalizedDescription.length > 1024 ||
      normalizedDescription.startsWith("[TODO:") || /[<>]/.test(normalizedDescription)) {
    return { ok: false, message: "Description must be nonempty, at most 1024 characters, and free of TODO/angle brackets" };
  }

  let fence = null;
  for (const line of lines.slice(end + 1)) {
    const marker = line.match(/^[ \t]*(?:(?:[-+*]|\d+[.)])[ \t]+)?(`{3,}|~{3,})(.*)$/);
    if (marker) {
      if (!fence) fence = marker[1];
      else if (marker[1][0] === fence[0] && marker[1].length >= fence.length && !marker[2].trim()) fence = null;
      continue;
    }
    if (!fence && /^[ ]{0,3}\[TODO:[^\n]*\][ \t]*$/.test(line)) {
      return { ok: false, message: "Skill instructions contain an unfinished TODO placeholder" };
    }
  }
  return { ok: true, message: "Skill is valid!" };
}

if (require.main === module) {
  try {
    const directory = process.argv[2];
    if (!directory) throw new Error("Usage: node validateCplayoutSkillFrontmatter.cjs <skill_directory>");
    const result = validateSkillContent(fs.readFileSync(path.join(directory, "SKILL.md"), "utf8"));
    console.log(result.message);
    if (!result.ok) process.exitCode = 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { validateSkillContent };
