/**
 * @fileoverview Protocol Parser Module
 * Standardized parsing for CATS (Context) and DOGS (Diff/Change) bundles.
 */

const ParserUtils = {
  metadata: {
    id: 'ParserUtils',
    version: '2.0.0',
    dependencies: [],
    type: 'pure'
  },

  factory: () => {

    // --- CATS Protocol (Context Bundle) ---

    const parseCatsBundle = (content) => {
      const files = [];
      if (!content) return { reason: 'Empty content', files: [] };

      // Split by file markers
      const blocks = content.split(/```vfs-file\s*\n/);

      const reasonMatch = content.match(/\*\*Reason:\*\*\s*(.+)/);
      const reason = reasonMatch ? reasonMatch[1].trim() : 'Context bundle';

      // Skip index 0 (preamble)
      for (let i = 1; i < blocks.length; i++) {
        const block = blocks[i];

        // Strict path extraction
        const pathMatch = block.match(/^path:\s*(.+?)\s*\n```/);
        if (!pathMatch) continue;

        const filePath = pathMatch[1].trim();

        // Content extraction: Look for the next code block
        const contentStartRegex = /```\n([\s\S]*?)\n```/;
        const contentMatch = block.substring(pathMatch[0].length).match(contentStartRegex);

        if (contentMatch) {
          files.push({
            path: filePath,
            content: contentMatch[1]
          });
        }
      }

      return { reason, files };
    };

    const generateCatsBundle = (files, reason = 'Context Export') => {
      const date = new Date().toISOString();
      let out = `## PAWS Context Bundle (cats.md)\n**Generated:** ${date}\n**Reason:** ${reason}\n**Files:** ${files.length}\n\n---\n\n`;

      for (const f of files) {
        out += `\`\`\`vfs-file\npath: ${f.path}\n\`\`\`\n`;
        out += `\`\`\`\n${f.content}\n\`\`\`\n\n---\n\n`;
      }
      return out;
    };

    // --- DOGS Protocol (Change Proposal) ---

    const parseDogsBundle = (content) => {
      const changes = [];
      if (!content) return changes;

      const blocks = content.split(/```paws-change\s*\n/);

      for (let i = 1; i < blocks.length; i++) {
        const block = blocks[i];

        const metaEndIdx = block.indexOf('```');
        if (metaEndIdx === -1) continue;

        const metaSection = block.substring(0, metaEndIdx);
        const opMatch = metaSection.match(/operation:\s*(CREATE|MODIFY|DELETE)/i);
        const pathMatch = metaSection.match(/file_path:\s*(.+)/);

        if (!opMatch || !pathMatch) continue;

        const operation = opMatch[1].toUpperCase();
        const filePath = pathMatch[1].trim();
        let newContent = null;

        if (operation !== 'DELETE') {
          // Look for content block after the meta block
          const contentSection = block.substring(metaEndIdx + 3);
          const contentMatch = contentSection.match(/```\n([\s\S]*?)\n```/);
          newContent = contentMatch ? contentMatch[1] : '';
        }

        changes.push({ operation, file_path: filePath, new_content: newContent });
      }

      return changes;
    };

    const generateDogsBundle = (changes, summary = 'Code Modification') => {
      let out = `## PAWS Change Proposal (dogs.md)\n**Summary:** ${summary}\n**Changes:** ${changes.length}\n\n---\n\n`;

      for (const c of changes) {
        out += `\`\`\`paws-change\noperation: ${c.operation}\nfile_path: ${c.file_path}\n\`\`\`\n`;
        if (c.operation !== 'DELETE') {
          out += `\`\`\`\n${c.new_content || ''}\n\`\`\`\n\n`;
        }
      }
      return out;
    };

    return {
      parseCatsBundle,
      generateCatsBundle,
      parseDogsBundle,
      generateDogsBundle
    };
  }
};

export default ParserUtils;
