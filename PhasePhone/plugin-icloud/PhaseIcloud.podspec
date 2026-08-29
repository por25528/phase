require 'json'

package = JSON.parse(File.read(File.join(__dir__, 'package.json')))

# The pod's NAME is `PhaseIcloud`, not `PhaseICloud`, and it is not a choice.
# Capacitor derives the pod it writes into the Podfile from the npm package name
# — `phase-icloud` → `PhaseIcloud`, via `fixName` in @capacitor/cli — and
# CocoaPods refuses a podspec whose `s.name` disagrees with the file it was
# asked for. The Swift class stays `PhaseICloud`; a pod name and a class name
# have never had to match.
Pod::Spec.new do |s|
  s.name = 'PhaseIcloud'
  s.version = package['version']
  s.summary = package['description']
  s.license = 'MIT'
  s.homepage = 'https://github.com/por25528/Phase'
  s.author = 'Phase'
  s.source = { :git => 'https://github.com/por25528/Phase.git', :tag => s.version.to_s }
  s.source_files = 'ios/Plugin/**/*.{swift,h,m,c,cc,mm,cpp}'
  s.ios.deployment_target = '14.0'
  s.dependency 'Capacitor'
  s.swift_version = '5.1'
end
