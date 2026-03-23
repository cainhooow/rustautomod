mod core;
mod daemon;
mod jsonrpc;

fn main() {
    if let Err(error) = daemon::run(std::env::args().skip(1).collect()) {
        eprintln!("rustautomod-zed-daemon: {error:#}");
        std::process::exit(1);
    }
}
