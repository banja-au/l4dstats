fn main() {
    const ZERO_HASH: &str = "0000000000000000000000000000000000000000000000000000000000000000";
    println!("cargo:rerun-if-env-changed=L4DSTATS_NATIVE_BUILD_SHA256");
    let hash =
        std::env::var("L4DSTATS_NATIVE_BUILD_SHA256").unwrap_or_else(|_| ZERO_HASH.to_owned());
    assert!(
        hash.len() == 64 && hash.bytes().all(|byte| byte.is_ascii_hexdigit()),
        "L4DSTATS_NATIVE_BUILD_SHA256 must be exactly 64 hexadecimal characters"
    );
    println!("cargo:rustc-env=L4DSTATS_NATIVE_BUILD_SHA256={hash}");
    napi_build::setup();
}
