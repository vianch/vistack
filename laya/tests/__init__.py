import os
import tempfile

# Developer shells export VISTACK_LAYA_JEV=1 and a TypeSafe key, which send `auto` engines to live, billed Jev.
for _name in [name for name in os.environ if name.startswith(("VISTACK_LAYA_", "TYPESAFE_")) or name == "OLLAMA_HOST"]:
    del os.environ[_name]
# The machine cache holds the live Clef server record and the Jev refusal file; status tests must
# not read or signal either.
os.environ["VISTACK_LAYA_CACHE_DIR"] = tempfile.mkdtemp(prefix="laya-tests-")
