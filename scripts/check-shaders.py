#!/usr/bin/env python3
"""Structural GLSL lint for the expanded voxel shaders.

There is no GPU or GLSL compiler available in CI here, so this performs the
checks that catch the mistakes a template-string shader pipeline actually makes:

  * identifiers used in the fragment/vertex source that are never declared,
    never a GLSL builtin, and not a three.js injected name,
  * reversed `smoothstep` edges (undefined behaviour per the GLSL spec),
  * `#include` chunks that were left unresolved.

Usage: python3 scripts/check-shaders.py <dir-with-glsl-files>
"""
import json
import re
import sys
from pathlib import Path

GLSL_BUILTINS = set(
    """
    abs acos acosh all any asin asinh atan atanh bitCount bitfieldExtract
    bitfieldInsert bitfieldReverse ceil clamp cos cosh cross dFdx dFdy degrees
    determinant distance dot equal exp exp2 faceforward findLSB findMSB floatBitsToInt
    floatBitsToUint floor fma fract frexp fwidth greaterThan greaterThanEqual
    imulExtended intBitsToFloat inverse inversesqrt isinf isnan ldexp length
    lessThan lessThanEqual log log2 matrixCompMult max min mix mod modf normalize
    not notEqual outerProduct packHalf2x16 packSnorm2x16 packUnorm2x16 pow
    radians reflect refract round roundEven sign sin sinh smoothstep sqrt step
    tan tanh texelFetch texelFetchOffset texture textureGrad textureLod
    textureOffset textureProj textureProjGrad textureProjLod textureProjOffset
    textureSize transpose trunc uintBitsToFloat unpackHalf2x16 unpackSnorm2x16
    unpackUnorm2x16
    vec2 vec3 vec4 ivec2 ivec3 ivec4 uvec2 uvec3 uvec4 bvec2 bvec3 bvec4
    mat2 mat3 mat4 mat2x3 mat2x4 mat3x2 mat3x4 mat4x2 mat4x3
    float int uint bool void
    if else for while do break continue return discard struct const uniform
    varying attribute in out inout layout precision highp mediump lowp
    true false main
    gl_Position gl_FragColor gl_FragCoord gl_PointSize gl_FrontFacing
    gl_FragDepth gl_MaxVertexAttribs
    """.split()
)

# Names three.js injects into every ShaderMaterial / built-in material shader.
THREE_INJECTED = set(
    """
    modelMatrix modelViewMatrix projectionMatrix viewMatrix normalMatrix
    cameraPosition isOrthographic position normal uv uv1 uv2 uv3 color tangent
    morphTargets
    diffuse opacity map alphaMap aoMap emissive envMap roughness metalness
    specular shininess clearcoat clearcoatRoughness sheen sheenRoughness
    sheenColor iridescence iridescenceIOR iridescenceThicknessRange
    transmission thickness attenuationColor attenuationDistance
    diffuseColor outgoingLight reflectedLight totalDiffuse totalSpecular
    totalEmissiveRadiance material geometryViewDir geometryNormal geometryClearcoatNormal
    envMapIntensity toneMappingExposure
    direction vViewPosition vNormal vUv vColor aAo aColor
    lightMap lightMapIntensity
    """.split()
)

reversed_smoothstep = []
undeclared = []


def declared_names(source: str) -> set:
    names = set()
    # uniform/varying/attribute declarations (possibly with precision qualifiers)
    for match in re.finditer(
        r"\b(?:uniform|varying|attribute|const|in|out)\s+(?:highp\s+|mediump\s+|lowp\s+)?"
        r"(?:[a-zA-Z_]\w*)\s+([a-zA-Z_]\w*)",
        source,
    ):
        names.add(match.group(1))
    # local variables and function parameters
    for match in re.finditer(
        r"\b(?:float|int|uint|bool|void|vec[234]|ivec[234]|uvec[234]|bvec[234]|mat[234])\s+"
        r"([a-zA-Z_]\w*)\s*[;=,)\[]",
        source,
    ):
        names.add(match.group(1))
    # struct members and function names
    for match in re.finditer(r"\b([a-zA-Z_]\w*)\s*\(", source):
        names.add(match.group(1))
    for match in re.finditer(r"\b([a-zA-Z_]\w*)\s*\.\s*[a-zA-Z_]", source):
        names.add(match.group(1))
    for match in re.finditer(r"\b([a-zA-Z_]\w*)\s*\.\s*(?:x|y|z|w|r|g|b|a)\b", source):
        names.add(match.group(1))
    for match in re.finditer(r",\s*([a-zA-Z_]\w*)\s*=", source):
        names.add(match.group(1))
    # macro definitions
    for match in re.finditer(r"#define\s+([a-zA-Z_]\w*)", source):
        names.add(match.group(1))
    return names


def strip_comments_and_strings(source: str) -> str:
    source = re.sub(r"/\*.*?\*/", " ", source, flags=re.S)
    source = re.sub(r"//[^\n]*", " ", source)
    source = re.sub(r"#[^\n]*", " ", source)  # preprocessor lines
    source = re.sub(r'"(?:[^"\\]|\\.)*"', " ", source)
    return source


def check_file(path: Path) -> None:
    raw = path.read_text()
    if "#include" in raw:
        undeclared.append((path.name, "<unresolved #include>"))
        return

    for match in re.finditer(
        r"\bsmoothstep\s*\(\s*([-+]?(?:\d+\.?\d*|\.\d+))\s*,\s*([-+]?(?:\d+\.?\d*|\.\d+))\s*,",
        raw,
    ):
        low, high = float(match.group(1)), float(match.group(2))
        if low >= high:
            reversed_smoothstep.append((path.name, match.group(0)))

    source = strip_comments_and_strings(raw)
    known = declared_names(source) | GLSL_BUILTINS | THREE_INJECTED
    swizzle_names = {"x", "y", "z", "w", "r", "g", "b", "a", "s", "t", "p", "q"}
    for match in re.finditer(r"\b([a-zA-Z_]\w*)\b(?!\s*\()", source):
        name = match.group(1)
        if name in swizzle_names:
            continue
        if name in known or re.fullmatch(r"[A-Za-z_]\d*", name) is None:
            continue
        if name.upper() == name:  # #define style constant
            continue
        if name in {"NUM_CLIPPING_PLANES", "UNION_CLIPPING_PLANES"}:
            continue
        undeclared.append((path.name, name))


def main() -> int:
    root = Path(sys.argv[1] if len(sys.argv) > 1 else "/tmp/shader-out")
    files = sorted(root.glob("*.glsl"))
    if not files:
        print(f"no shader files found in {root}")
        return 1
    for path in files:
        check_file(path)

    # Every GLSL builtin call must be spelled correctly; flag near-misses
    # produced by broken template interpolation (e.g. "Math.c eil").
    problems = 0
    if reversed_smoothstep:
        problems += len(reversed_smoothstep)
        print("reversed smoothstep edges:")
        for name, snippet in reversed_smoothstep:
            print(f"  {name}: {snippet}")

    # Words that look like GLSL builtins but are not, which is how a mangled
    # template interpolation usually shows up.
    near_misses = {
        "celi": "ceil",
        "floo": "floor",
        "clamp_": "clamp",
        "mix_": "mix",
        "normaliz": "normalize",
        "texture2": "texture",
        "smoothste": "smoothstep",
    }
    for path in files:
        source = strip_comments_and_strings(path.read_text())
        for bad, good in near_misses.items():
            if re.search(rf"\b{bad}\b", source):
                problems += 1
                print(f"  {path.name}: '{bad}' looks like a broken '{good}'")

    duplicates = {}
    for name, ident in undeclared:
        duplicates.setdefault(name, set()).add(ident)
    if duplicates:
        problems += 1
        print("undeclared identifiers:")
        for name, idents in duplicates.items():
            print(f"  {name}: {', '.join(sorted(idents))}")

    print(json.dumps({"files": len(files), "problems": problems}))
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
