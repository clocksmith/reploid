import { describe, expect, it } from 'vitest';
import {
  PROTEIN_REPRESENTATION_IDENTITY_SCHEMA,
  PROTEIN_INVESTIGATION_SCHEMA,
  STANDARD_AMINO_ACIDS,
  normalizeAminoAcidSequence,
  createProteinRepresentationIdentity,
  cosineSimilarity,
  rankProteinCandidates,
  assembleProteinLiteraturePassages,
  partitionSequenceWorkload,
  projectProteinInvestigation,
  validateProteinInvestigation
} from '../../self/pool/protein-investigation.js';

describe('protein investigation and modality separation', () => {
  const sampleSequenceA = 'MAPLALLLLGLVAGA';
  const sampleSequenceB = 'MKTLLLTLLVVTIVCL';

  describe('normalizeAminoAcidSequence', () => {
    it('accepts standard 20 amino acid sequences with whitespace and lowercase', () => {
      const normalized = normalizeAminoAcidSequence('  mapl allll glvaga \n');
      expect(normalized).toBe('MAPLALLLLGLVAGA');
      expect(normalized.length).toBe(15);
    });

    it('rejects empty or non-string sequence', () => {
      expect(() => normalizeAminoAcidSequence('')).toThrow(TypeError);
      expect(() => normalizeAminoAcidSequence('   ')).toThrow(TypeError);
      expect(() => normalizeAminoAcidSequence(null)).toThrow(TypeError);
      expect(() => normalizeAminoAcidSequence(123)).toThrow(TypeError);
    });

    it('rejects non-standard or ambiguous amino acids (B, Z, X, J, U, O, numbers)', () => {
      expect(() => normalizeAminoAcidSequence('MAPLXB')).toThrow(/Invalid amino acid character/);
      expect(() => normalizeAminoAcidSequence('MAP123')).toThrow(/Invalid amino acid character/);
      expect(() => normalizeAminoAcidSequence('ACDEFGHIKLMNPQRSTVWYZ')).toThrow(/Invalid amino acid character/);
    });

    it('contains all 20 standard amino acids', () => {
      expect(STANDARD_AMINO_ACIDS.size).toBe(20);
      const all20 = 'ACDEFGHIKLMNPQRSTVWY';
      expect(normalizeAminoAcidSequence(all20)).toBe(all20);
    });
  });

  describe('createProteinRepresentationIdentity', () => {
    it('creates a deterministic representation identity binding sequence and model contract', async () => {
      const rep = await createProteinRepresentationIdentity({
        sequence: sampleSequenceA,
        modelId: 'esm2-35m',
        precision: 'f16'
      });
      expect(rep.schema).toBe(PROTEIN_REPRESENTATION_IDENTITY_SCHEMA);
      expect(rep.sequence).toBe(sampleSequenceA);
      expect(rep.sequenceLength).toBe(15);
      expect(rep.sequenceHash).toMatch(/^sha256:[a-f0-9]{64}$/);
      expect(rep.representationIdentityHash).toMatch(/^sha256:[a-f0-9]{64}$/);
      expect(rep.modelContract.modelId).toBe('esm2-35m');
      expect(rep.modelContract.precision).toBe('f16');

      // Deterministic replay
      const rep2 = await createProteinRepresentationIdentity({
        sequence: 'maplallllglvaga',
        modelId: 'esm2-35m',
        precision: 'f16'
      });
      expect(rep2.sequenceHash).toBe(rep.sequenceHash);
      expect(rep2.representationIdentityHash).toBe(rep.representationIdentityHash);
    });

    it('produces distinct identity hashes for different sequences or contracts', async () => {
      const repA = await createProteinRepresentationIdentity({ sequence: sampleSequenceA });
      const repB = await createProteinRepresentationIdentity({ sequence: sampleSequenceB });
      const repA_f32 = await createProteinRepresentationIdentity({ sequence: sampleSequenceA, precision: 'f32' });

      expect(repA.sequenceHash).not.toBe(repB.sequenceHash);
      expect(repA.representationIdentityHash).not.toBe(repB.representationIdentityHash);
      expect(repA.representationIdentityHash).not.toBe(repA_f32.representationIdentityHash);
    });
  });

  describe('cosineSimilarity', () => {
    it('computes exact cosine similarity for parallel and orthogonal vectors', () => {
      expect(cosineSimilarity([1, 0], [1, 0])).toBeCloseTo(1.0, 5);
      expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1.0, 5);
      expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0.0, 5);
      expect(cosineSimilarity([1, 2, 3], [2, 4, 6])).toBeCloseTo(1.0, 5);
    });

    it('handles zero norms safely without NaN', () => {
      expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
      expect(cosineSimilarity([0, 0, 0], [0, 0, 0])).toBe(0);
    });

    it('rejects dimension mismatch or non-finite numbers', () => {
      expect(() => cosineSimilarity([1, 2], [1, 2, 3])).toThrow(TypeError);
      expect(() => cosineSimilarity([1, Infinity], [1, 2])).toThrow(TypeError);
    });
  });

  describe('rankProteinCandidates', () => {
    it('ranks candidates descending by cosine score with deterministic tie-breaking', () => {
      const queryEmbedding = [1.0, 0.0, 0.0];
      const referenceIndex = [
        { accession: 'P00003', name: 'Low match', embedding: [0.2, 0.9, 0.0] },
        { accession: 'P00002', name: 'Identical B', embedding: [1.0, 0.0, 0.0] },
        { accession: 'P00001', name: 'Identical A', embedding: [1.0, 0.0, 0.0] },
        { accession: 'P00004', name: 'Negative match', embedding: [-1.0, 0.0, 0.0] }
      ];

      const ranked = rankProteinCandidates({ queryEmbedding, referenceIndex, topK: 3 });
      expect(ranked).toHaveLength(3);
      expect(ranked[0].accession).toBe('P00001'); // Tie broken alphabetically
      expect(ranked[0].score).toBeCloseTo(1.0, 5);
      expect(ranked[0].rank).toBe(1);

      expect(ranked[1].accession).toBe('P00002');
      expect(ranked[1].score).toBeCloseTo(1.0, 5);
      expect(ranked[1].rank).toBe(2);

      expect(ranked[2].accession).toBe('P00003');
      expect(ranked[2].score).toBeCloseTo(0.2 / Math.sqrt(0.2 * 0.2 + 0.9 * 0.9), 4);
      expect(ranked[2].rank).toBe(3);
    });

    it('filters candidates below minScore', () => {
      const queryEmbedding = [1.0, 0.0];
      const referenceIndex = [
        { accession: 'P1', embedding: [1.0, 0.0] },
        { accession: 'P2', embedding: [0.0, 1.0] },
        { accession: 'P3', embedding: [-1.0, 0.0] }
      ];
      const ranked = rankProteinCandidates({ queryEmbedding, referenceIndex, minScore: 0.5 });
      expect(ranked).toHaveLength(1);
      expect(ranked[0].accession).toBe('P1');
    });
  });

  describe('assembleProteinLiteraturePassages', () => {
    it('retrieves structured passages by accession ID without cross-modal projection', () => {
      const candidates = [
        { accession: 'P12345', score: 0.95 },
        { accession: 'Q67890', score: 0.82 }
      ];

      const annotationStore = new Map([
        ['P12345', [
          { title: 'Function', text: 'Catalyzes the phosphorylation of target kinase proteins.' },
          { title: 'Subcellular Location', text: 'Cytoplasm and nucleus.' }
        ]],
        ['Q67890', { title: 'Function', text: 'Acts as a GTPase-activating protein in cell cycle regulation.' }]
      ]);

      const passages = assembleProteinLiteraturePassages({ candidates, annotationStore });
      expect(passages).toHaveLength(3);
      expect(passages[0].id).toBe('passage-1');
      expect(passages[0].accession).toBe('P12345');
      expect(passages[0].text).toContain('[Accession: P12345] Function: Catalyzes the phosphorylation');
      expect(passages[0].candidateScore).toBe(0.95);

      expect(passages[1].accession).toBe('P12345');
      expect(passages[1].text).toContain('[Accession: P12345] Subcellular Location: Cytoplasm and nucleus.');

      expect(passages[2].accession).toBe('Q67890');
      expect(passages[2].text).toContain('[Accession: Q67890] Function: Acts as a GTPase-activating protein');
    });

    it('returns empty array when no candidates match store', () => {
      const candidates = [{ accession: 'UNKNOWN_ACCESSION', score: 0.5 }];
      const passages = assembleProteinLiteraturePassages({ candidates, annotationStore: {} });
      expect(passages).toEqual([]);
    });
  });

  describe('partitionSequenceWorkload', () => {
    it('partitions full sequences into coarse-grained batches without token sharding', () => {
      const seqs = ['ACDEF', 'GHIKL', 'MNPQR', 'STVWY'];
      const batches = partitionSequenceWorkload({ sequences: seqs, maxBatchSize: 2 });
      expect(batches).toHaveLength(2);
      expect(batches[0]).toHaveLength(2);
      expect(batches[0][0].sequence).toBe('ACDEF');
      expect(batches[0][1].sequence).toBe('GHIKL');
      expect(batches[1]).toHaveLength(2);
      expect(batches[1][0].sequence).toBe('MNPQR');
      expect(batches[1][1].sequence).toBe('STVWY');
    });
  });

  describe('projectProteinInvestigation & validateProteinInvestigation', () => {
    it('projects a valid investigation with competing hypotheses and campaign uncertainty', async () => {
      const question = 'What catalytic activity and domain family does target sequence MAPLALLLLGLVAGA exhibit?';
      const competingHypotheses = [
        {
          id: 'hyp-1',
          statement: 'Target sequence belongs to the serine/threonine protein kinase family.',
          rationale: 'High representation similarity to conserved catalytic kinase domain.',
          status: 'active'
        },
        {
          id: 'hyp-2',
          statement: 'Target sequence belongs to a signal peptide region of a transmembrane glycoprotein.',
          rationale: 'Strong representation alignment with secretory leader sequences.',
          status: 'active'
        }
      ];

      const candidateMatches = [
        { rank: 1, accession: 'P12345', score: 0.94, name: 'Kinase homolog A' },
        { rank: 2, accession: 'Q67890', score: 0.72, name: 'Glycoprotein precursor' }
      ];

      const passages = [
        { id: 'passage-1', accession: 'P12345', text: '[Accession: P12345] Function: Protein serine/threonine kinase.' }
      ];

      const investigation = await projectProteinInvestigation({
        question,
        targetSequence: sampleSequenceA,
        competingHypotheses,
        candidateMatches,
        passages
      });

      expect(investigation.schema).toBe(PROTEIN_INVESTIGATION_SCHEMA);
      expect(investigation.investigationHash).toMatch(/^sha256:[a-f0-9]{64}$/);
      expect(investigation.competingHypotheses).toHaveLength(2);
      expect(investigation.uncertaintyDimensions.length).toBeGreaterThanOrEqual(3);

      const validation = validateProteinInvestigation(investigation);
      expect(validation.ok).toBe(true);
      expect(validation.reasons).toEqual([]);
    });

    it('rejects investigation with fewer than 2 competing hypotheses', async () => {
      const investigation = await projectProteinInvestigation({
        question: 'Single hypothesis test',
        targetSequence: sampleSequenceA,
        competingHypotheses: [
          { id: 'hyp-1', statement: 'Only one hypothesis', status: 'active' }
        ]
      });
      const validation = validateProteinInvestigation(investigation);
      expect(validation.ok).toBe(false);
      expect(validation.reasons[0]).toContain('at least 2 competing alternatives');
    });
  });
});
