'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createAnswerPacket, validateAnswerPacket, IMAGE_PATH_WHITELIST, renderAnsweredMarkdown } = require('./visualReviewAnswers.cjs');
const { generateQuestionnaireHtml } = require('./visualReviewQuestionnaire.cjs');
const { newOutputDirectory } = require('./reviewEvidenceIdentity.cjs');

// This builder only creates a new receipt directory; it never edits the source form.
function buildReceipt(inputPath, originalPacket, outputDirectory) {
  const input = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  // Browser downloads are complete versioned packets. The smaller legacy chat
  // input is accepted separately so an unknown field never becomes "verified".
  const packet = Object.hasOwn(input, 'schemaVersion')
    ? validateAnswerPacket(input) : createAnswerPacket(input);
  const source = fs.realpathSync(originalPacket);
  const output = newOutputDirectory(source, outputDirectory);
  const imageData = {};
  const hashes = {};
  for (const relative of IMAGE_PATH_WHITELIST) {
    const imagePath = fs.realpathSync(path.join(source, relative));
    if (!imagePath.startsWith(source + path.sep)) throw new Error('Image escaped source packet');
    const bytes = fs.readFileSync(imagePath);
    if (bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error('Expected PNG evidence');
    imageData[relative] = `data:image/png;base64,${bytes.toString('base64')}`;
    hashes[relative] = crypto.createHash('sha256').update(bytes).digest('hex');
  }
  const annotations = JSON.parse(fs.readFileSync(path.join(source, 'annotations.json'), 'utf8'));
  const observations = Object.fromEntries(annotations.figures.map(figure => [`Q${figure.id}`, figure.notes]));
  const html = generateQuestionnaireHtml({ seedPacket: packet, imageData, observations });
  fs.mkdirSync(output); // Existing evidence must never be overwritten.
  fs.mkdirSync(path.join(output, 'annotated'));
  for (const relative of IMAGE_PATH_WHITELIST) fs.copyFileSync(path.join(source, relative), path.join(output, relative), fs.constants.COPYFILE_EXCL);
  fs.writeFileSync(path.join(output, 'answers.json'), JSON.stringify(packet, null, 2) + '\n', { flag: 'wx' });
  fs.writeFileSync(path.join(output, 'questionnaire.html'), html, { flag: 'wx' });
  let markdown = renderAnsweredMarkdown(packet);
  for (const [id, notes] of Object.entries(observations)) {
    const heading = `Question ID: ${id}\n`;
    markdown = markdown.replace(heading, heading + '\nAgent observations (original packet):\n\n' + notes.map(note => `- ${note}`).join('\n') + '\n');
  }
  fs.writeFileSync(path.join(output, 'questionnaire.md'), markdown, { flag: 'wx' });
  fs.writeFileSync(path.join(output, 'manifest.json'), JSON.stringify({
    sourcePacket: source, responseSource: path.resolve(inputPath), packetId: packet.packetId,
    responseStatus: 'imported-unattributed', declaredSource: packet.source,
    authorshipVerified: false, evidenceBinding: 'legacy-unbound', decisionChoice: packet.answers.Q10.choice,
    decisionLabel: packet.questionCatalog[9].choices.find(choice => choice.value === packet.answers.Q10.choice)?.label ?? 'No choice selected', imageSha256: hashes,
    originalImagesModified: false, generatedAt: new Date().toISOString(),
  }, null, 2) + '\n', { flag: 'wx' });
  return output;
}

if (require.main === module) {
  if (process.argv.length !== 5) throw new Error('Usage: node tools/buildVisualReviewReceipt.cjs responses.json original-packet new-receipt-directory');
  console.log(buildReceipt(...process.argv.slice(2)));
}
module.exports = { buildReceipt };
