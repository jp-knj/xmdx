use std::env;

fn main() {
    if env::var("NAPI_RS_CLI_VERSION").is_err() {
        println!("cargo:rustc-env=NAPI_RS_CLI_VERSION=manual-build");
    }

    napi_build::setup();
}
