{
  description = "Verifiabl Node SDK development shell";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs = { nixpkgs, ... }:
    let
      systems = [ "x86_64-linux" "aarch64-linux" "aarch64-darwin" ];
      forAllSystems = nixpkgs.lib.genAttrs systems;
    in
    {
      devShells = forAllSystems (system:
        let pkgs = import nixpkgs { inherit system; };
        in {
          default = pkgs.mkShell {
            packages = [ pkgs.nodejs_22 ];
            shellHook = ''
              echo "Verifiabl Node SDK: Node $(node --version), npm $(npm --version)"
              echo "Run: npm ci && npm test"
            '';
          };
        });
    };
}
