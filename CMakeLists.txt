cmake_minimum_required(VERSION 3.20)
project(openrac_graphics_effects_runtime LANGUAGES C CXX)

if(NOT OpenRACMod_DIR)
  if(DEFINED OPENRAC_SDK)
    set(OpenRACMod_DIR "${OPENRAC_SDK}/cmake")
  elseif(EXISTS "${CMAKE_CURRENT_SOURCE_DIR}/sdk.lock")
    file(READ "${CMAKE_CURRENT_SOURCE_DIR}/sdk.lock" lock)
    string(JSON sdk_version GET "${lock}" version)
    set(OpenRACMod_DIR "${CMAKE_CURRENT_SOURCE_DIR}/.sdk/openrac-mod-sdk-${sdk_version}/cmake")
  endif()
endif()
find_package(OpenRACMod 1.14 REQUIRED)

openrac_add_mod(
  graphics_effects_runtime
  MANIFEST effects-runtime/openrac-mod.json
  SOURCES effects-runtime/src/mod.cpp
)

get_target_property(EFFECTS_PACKAGE_DIR graphics_effects_runtime OPENRAC_MOD_PACKAGE_DIR)
add_custom_command(TARGET graphics_effects_runtime POST_BUILD
  COMMAND ${CMAKE_COMMAND} -E make_directory "${EFFECTS_PACKAGE_DIR}/assets"
  COMMAND ${CMAKE_COMMAND} -E copy_if_different
          "${CMAKE_CURRENT_SOURCE_DIR}/effects-runtime/assets/particle.glb"
          "${EFFECTS_PACKAGE_DIR}/assets/particle.glb"
  COMMENT "Adding Graphics Effects Runtime assets"
)


# Unified product: the same official-API runtime is also built as the native
# library of graphics-preparation itself. The tool page and the native runtime
# therefore install as one OpenRAC mod and one ZIP.
file(READ "${CMAKE_CURRENT_SOURCE_DIR}/openrac-mod.json" GRAPHICS_PREPARATION_MANIFEST_JSON)
string(JSON GRAPHICS_PREPARATION_VERSION GET "${GRAPHICS_PREPARATION_MANIFEST_JSON}" version)

openrac_add_mod(
  graphics_preparation_runtime
  MANIFEST openrac-mod.json
  SOURCES effects-runtime/src/mod.cpp
)
target_compile_definitions(graphics_preparation_runtime PRIVATE
  GRAPHICS_EFFECTS_MOD_ID="graphics-preparation"
  GRAPHICS_EFFECTS_MOD_VERSION="${GRAPHICS_PREPARATION_VERSION}"
)
get_target_property(GRAPHICS_PREPARATION_PACKAGE_DIR graphics_preparation_runtime OPENRAC_MOD_PACKAGE_DIR)
add_custom_command(TARGET graphics_preparation_runtime POST_BUILD
  COMMAND ${CMAKE_COMMAND} -E make_directory "${GRAPHICS_PREPARATION_PACKAGE_DIR}/assets"
  COMMAND ${CMAKE_COMMAND} -E copy_if_different
          "${CMAKE_CURRENT_SOURCE_DIR}/effects-runtime/assets/particle.glb"
          "${GRAPHICS_PREPARATION_PACKAGE_DIR}/assets/particle.glb"
  COMMENT "Adding integrated Graphics preparation runtime assets"
)
