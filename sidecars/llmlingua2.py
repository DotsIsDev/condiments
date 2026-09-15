#!/usr/bin/env python3
"""Optional LLMLingua-2 JSON stdin/stdout bridge. Install llmlingua separately."""

import argparse
import json
import sys


def load_compressor():
    from llmlingua import PromptCompressor
    return PromptCompressor(model_name="microsoft/llmlingua-2-xlm-roberta-large-meetingbank", use_llmlingua2=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--probe", action="store_true")
    args = parser.parse_args()
    try:
        compressor = load_compressor()
    except Exception as error:
        print(json.dumps({"available": False, "detail": str(error)}))
        return 1
    if args.probe:
        print(json.dumps({"available": True, "detail": "llmlingua2 ready"}))
        return 0
    request = json.load(sys.stdin)
    text = str(request.get("text", ""))
    rate = float(request.get("target_rate", 0.5))
    result = compressor.compress_prompt_llmlingua2(text, rate=rate, force_tokens=[str(request.get("query", ""))] if request.get("query") else [])
    compressed = result.get("compressed_prompt", text)
    print(json.dumps({
        "compressed_text": compressed,
        "source_tokens": result.get("origin_tokens"),
        "compressed_tokens": result.get("compressed_tokens"),
    }))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
