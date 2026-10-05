import os
import tempfile

# Developer shells export VISTACK_LAYA_JEV=1, a TypeSafe key, and Cloudflare credentials, which
# send opted-in engines to live hosted tiers.
for _name in [name for name in os.environ if name.startswith(("VISTACK_LAYA_", "TYPESAFE_", "CLOUDFLARE_")) or name == "OLLAMA_HOST"]:
    del os.environ[_name]
# The machine cache holds the Jev refusal file; status tests must not read it.
os.environ["VISTACK_LAYA_CACHE_DIR"] = tempfile.mkdtemp(prefix="laya-tests-")
