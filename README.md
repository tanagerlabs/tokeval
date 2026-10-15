<p align="center">
  <img src="docs/assets/token-mark.svg" width="560" alt="Three UTF-8 byte pieces forming a token">
</p>

# TokenLab

*Investigating the hidden cost of language in AI.*

TokenLab is an open-source research and engineering project for measuring, explaining, visualizing, and reducing multilingual LLM tokenization inefficiency. Korean is the first optimization case study, with English as an initial baseline and support for more languages designed to remain extensible.

## What we're building

- **Explorer:** byte-safe, side-by-side visualization of real tokenizer output.
- **Bench:** reproducible multilingual tokenization and runtime evaluation.
- **Train:** controlled tokenizer and model-adaptation experiments.
- **Serve:** GPU benchmarks connecting tokenization to latency, memory, energy, quality, and cost.

## Research principles

- Measure cost per successful task—not token count alone.
- Keep token efficiency, model quality, serving performance, and price distinct.
- Preserve raw bytes because token boundaries may split UTF-8 code points.
- Publish controlled comparisons with versioned data, models, software, hardware, and seeds.
- Treat every claimed improvement as a result to demonstrate, not an assumption.


For more info, see [PROJECT_CONTEXT.md](PROJECT_CONTEXT.md).
