{ pkgs ? import <nixpkgs> {} }:

pkgs.mkShell {
  buildInputs = with pkgs; [
    nodejs
    python3
    python3Packages.websockets
    python3Packages.pyserial
    python3Packages.pymavlink
  ];
}
