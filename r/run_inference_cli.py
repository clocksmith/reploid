#!/usr/bin/env python3
"""
A command-line interface for single-shot inference and benchmarking of GGUF models.

This script loads a model, runs a single prompt through it, and provides
detailed system and performance statistics for the generation.
"""

import argparse
import os
import time
from typing import Dict, Any

from llama_cpp import Llama, __version__ as llama_cpp_version
import llm_utils


def run_generation(llm: Llama, prompt: str, max_tokens: int) -> Dict[str, Any]:
    """Generates a response from the model and captures performance data.

    Args:
        llm: The loaded Llama model instance.
        prompt: The user prompt to send to the model.
        max_tokens: The maximum number of tokens to generate.

    Returns:
        The full response data dictionary from create_chat_completion.
    """
    messages = [{"role": "user", "content": prompt}]
    print(f"--- Generating Response for Prompt ---")
    print(f"\033[94mUser:\033[0m {prompt}")

    generation_start_time = time.time()
    response_data = llm.create_chat_completion(
        messages=messages, max_tokens=max_tokens, stream=False
    )
    generation_end_time = time.time()

    full_response = response_data["choices"][0]["message"]["content"]
    print(f"\033[92mAssistant:\033[0m {full_response}")
    print("\n--- End of Response ---")

    response_data["wall_time_seconds"] = generation_end_time - generation_start_time
    return response_data


def print_performance_stats(response_data: Dict[str, Any]) -> None:
    """Prints detailed performance statistics from a generation run.

    Args:
        response_data: The response dictionary containing usage stats.
    """
    print("\n--- Performance Statistics ---")
    usage = response_data.get("usage", {})
    prompt_tokens = usage.get("prompt_tokens", 0)
    completion_tokens = usage.get("completion_tokens", 0)
    wall_time = response_data.get("wall_time_seconds", 0)

    print(f"Prompt Tokens:     {prompt_tokens}")
    print(f"Completion Tokens: {completion_tokens}")
    print(f"Total Wall Time:   {wall_time:.2f} seconds")

    if completion_tokens > 0 and wall_time > 0:
        tps = completion_tokens / wall_time
        print(f"Tokens per Second (Total): {tps:.2f} TPS")
    else:
        print("Not enough data to calculate performance.")
    print("--------------------------\n")


def main(args: argparse.Namespace) -> None:
    """The main execution function for the CLI.

    Args:
        args: Command-line arguments parsed by argparse.
    """
    model_path = f"models/{args.model}"
    if not os.path.exists(model_path):
        print(f"Error: Model file not found at '{model_path}'")
        return

    llm_utils.verify_and_report_gpu_support()

    llm = llm_utils.load_language_model(
        model_path=model_path,
        n_ctx=args.n_ctx,
        n_gpu_layers=args.n_gpu_layers,
        is_chat=True,
    )
    if not llm:
        return

    response_data = run_generation(llm, args.prompt, args.max_tokens)
    print_performance_stats(response_data)
    print("Inference CLI finished.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Run single-shot inference and benchmark GGUF models."
    )
    llm_utils.add_common_cli_args(parser)
    parser.add_argument(
        "-p",
        "--prompt",
        type=str,
        default="Write a short story about a robot exploring Mars.",
        help="The prompt to send to the model.",
    )
    parser.add_argument(
        "--max-tokens",
        type=int,
        default=256,
        help="Maximum number of tokens to generate.",
    )
    cli_args = parser.parse_args()
    main(cli_args)