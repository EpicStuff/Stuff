#include "seafileignoreaction.h"

#include <KFileItemListProperties>
#include <KPluginFactory>

#include <QAction>
#include <QDir>
#include <QFile>
#include <QFileInfo>
#include <QIcon>
#include <QMap>
#include <QSaveFile>
#include <QSet>
#include <QSettings>
#include <QStandardPaths>
#include <QUrl>
#include <QWidget>

#include <sqlite3.h>

#include <algorithm>

namespace
{
QString normalizePath(const QString &path)
{
	return QDir::cleanPath(QDir::fromNativeSeparators(QFileInfo(path).absoluteFilePath()));
}

bool isInsideOrEqual(const QString &root, const QString &path)
{
	return path == root || path.startsWith(root + QLatin1Char('/'));
}

QString expandHome(QString path)
{
	if (path == QStringLiteral("~"))
		return QDir::homePath();

	if (path.startsWith(QStringLiteral("~/")))
		return QDir::home().filePath(path.mid(2));

	return path;
}
}

SeafileIgnoreAction::SeafileIgnoreAction(QObject *parent, const QVariantList &args)
	: KAbstractFileItemActionPlugin(parent)
{
	Q_UNUSED(args)
}

QList<QAction *> SeafileIgnoreAction::actions(const KFileItemListProperties &fileItemInfos, QWidget *parentWidget)
{
	const QList<QUrl> urls = fileItemInfos.urlList();
	if (urls.isEmpty())
		return {};

	const QStringList knownWorktrees = worktrees();
	if (knownWorktrees.isEmpty())
		return {};

	QList<IgnoreItem> items;
	items.reserve(urls.size());

	for (const QUrl &url : urls) {
		if (!url.isLocalFile())
			return {};

		const auto item = resolveItem(url.toLocalFile(), knownWorktrees);
		if (!item.has_value())
			return {};

		items.append(*item);
	}

	const QString text = items.size() == 1
		? QStringLiteral("Add to Seafile ignore")
		: QStringLiteral("Add %1 items to Seafile ignore").arg(items.size());

	auto *action = new QAction(QIcon::fromTheme(QStringLiteral("list-add")), text, parentWidget);
	connect(action, &QAction::triggered, this, [this, items] {
		addToIgnore(items);
	});

	return {action};
}

QStringList SeafileIgnoreAction::repoDatabases() const
{
	QStringList iniFiles;

	const QString ccnetConfDir = qEnvironmentVariable("CCNET_CONF_DIR");
	if (!ccnetConfDir.isEmpty())
		iniFiles.append(QDir(normalizePath(expandHome(ccnetConfDir))).filePath(QStringLiteral("seafile.ini")));

	const QString defaultIni = QDir::home().filePath(QStringLiteral(".ccnet/seafile.ini"));
	if (!iniFiles.contains(defaultIni))
		iniFiles.append(defaultIni);

	const QString configPath = QDir(QStandardPaths::writableLocation(QStandardPaths::ConfigLocation))
		.filePath(QStringLiteral("dolphin-seafile-ignore.conf"));
	QSettings settings(configPath, QSettings::IniFormat);
	const QStringList configuredIniFiles = settings.value(QStringLiteral("General/SeafileIniFiles")).toStringList();

	for (const QString &configured : configuredIniFiles) {
		const QString expanded = expandHome(configured);
		if (!expanded.isEmpty() && !iniFiles.contains(expanded))
			iniFiles.append(expanded);
	}

	QStringList databases;
	for (const QString &iniPath : iniFiles) {
		QFile iniFile(iniPath);
		if (!iniFile.open(QIODevice::ReadOnly | QIODevice::Text))
			continue;

		while (!iniFile.atEnd()) {
			QString dataDir = QString::fromUtf8(iniFile.readLine()).trimmed();
			if (dataDir.isEmpty())
				continue;

			dataDir = normalizePath(expandHome(dataDir));
			const QString repoDatabase = QDir(dataDir).filePath(QStringLiteral("repo.db"));
			if (QFileInfo(repoDatabase).isFile() && !databases.contains(repoDatabase))
				databases.append(repoDatabase);
			break;
		}
	}

	return databases;
}

QStringList SeafileIgnoreAction::worktrees() const
{
	QStringList result;

	for (const QString &repoDatabase : repoDatabases()) {
		sqlite3 *database = nullptr;
		const QByteArray encodedPath = QFile::encodeName(repoDatabase);
		if (sqlite3_open_v2(encodedPath.constData(), &database, SQLITE_OPEN_READONLY | SQLITE_OPEN_FULLMUTEX, nullptr) != SQLITE_OK) {
			if (database != nullptr)
				sqlite3_close(database);
			continue;
		}

		sqlite3_stmt *statement = nullptr;
		constexpr const char *query = "SELECT value FROM RepoProperty WHERE key = 'worktree' AND value IS NOT NULL AND value <> ''";
		if (sqlite3_prepare_v2(database, query, -1, &statement, nullptr) != SQLITE_OK) {
			sqlite3_close(database);
			continue;
		}

		while (sqlite3_step(statement) == SQLITE_ROW) {
			const unsigned char *value = sqlite3_column_text(statement, 0);
			if (value == nullptr)
				continue;

			const QString worktree = normalizePath(QString::fromUtf8(reinterpret_cast<const char *>(value)));
			if (QFileInfo(worktree).isDir() && !result.contains(worktree))
				result.append(worktree);
		}

		sqlite3_finalize(statement);
		sqlite3_close(database);
	}

	return result;
}

std::optional<SeafileIgnoreAction::IgnoreItem> SeafileIgnoreAction::resolveItem(const QString &path, const QStringList &knownWorktrees) const
{
	const QString absolutePath = normalizePath(path);
	QString matchedWorktree;

	for (const QString &worktree : knownWorktrees) {
		if (!isInsideOrEqual(worktree, absolutePath))
			continue;

		if (worktree.size() > matchedWorktree.size())
			matchedWorktree = worktree;
	}

	if (matchedWorktree.isEmpty() || absolutePath == matchedWorktree)
		return std::nullopt;

	QString relativePath = QDir(matchedWorktree).relativeFilePath(absolutePath);
	relativePath = QDir::fromNativeSeparators(relativePath);

	if (relativePath.isEmpty() || relativePath == QStringLiteral(".") || relativePath.startsWith(QStringLiteral("../")) || QDir::isAbsolutePath(relativePath))
		return std::nullopt;

	if (relativePath == QStringLiteral("seafile-ignore.txt"))
		return std::nullopt;

	if (relativePath.startsWith(QLatin1Char('#')) || relativePath.contains(QLatin1Char('*')) || relativePath.contains(QLatin1Char('?')) || relativePath.contains(QLatin1Char('\n')) || relativePath.contains(QLatin1Char('\r')) || relativePath != relativePath.trimmed())
		return std::nullopt;

	QString pattern = relativePath;
	if (QFileInfo(absolutePath).isDir())
		pattern.append(QLatin1Char('/'));

	return IgnoreItem{matchedWorktree, pattern};
}

void SeafileIgnoreAction::addToIgnore(const QList<IgnoreItem> &items)
{
	QMap<QString, QSet<QString>> patternsByWorktree;
	for (const IgnoreItem &item : items)
		patternsByWorktree[item.worktree].insert(item.pattern);

	for (auto iterator = patternsByWorktree.cbegin(); iterator != patternsByWorktree.cend(); ++iterator) {
		const QString ignorePath = QDir(iterator.key()).filePath(QStringLiteral("seafile-ignore.txt"));
		QByteArray contents;

		QFile existingFile(ignorePath);
		if (existingFile.exists()) {
			if (!existingFile.open(QIODevice::ReadOnly)) {
				Q_EMIT error(QStringLiteral("Could not read %1: %2").arg(ignorePath, existingFile.errorString()));
				continue;
			}
			contents = existingFile.readAll();
		}

		QSet<QString> existingPatterns;
		const QList<QByteArray> lines = contents.split('\n');
		for (QByteArray line : lines) {
			if (line.endsWith('\r'))
				line.chop(1);
			const QString pattern = QString::fromUtf8(line).trimmed();
			if (!pattern.isEmpty() && !pattern.startsWith(QLatin1Char('#')))
				existingPatterns.insert(pattern);
		}

		QStringList additions;
		for (const QString &pattern : iterator.value()) {
			if (!existingPatterns.contains(pattern))
				additions.append(pattern);
		}

		if (additions.isEmpty())
			continue;

		std::sort(additions.begin(), additions.end());

		QByteArray additionsBlock;
		for (const QString &pattern : additions) {
			additionsBlock.append(pattern.toUtf8());
			additionsBlock.append('\n');
		}

		const QByteArray marker = QByteArrayLiteral("\n### SEAFILE-SYMLINK (AUTOGENERATED) ###");
		const qsizetype markerPosition = contents.indexOf(marker);

		if (markerPosition >= 0) {
			const qsizetype insertionPosition = markerPosition > 0 && contents.at(markerPosition - 1) == '\n'
				? markerPosition
				: markerPosition + 1;
			contents.insert(insertionPosition, additionsBlock);
		} else {
			if (!contents.isEmpty() && !contents.endsWith('\n'))
				contents.append('\n');
			contents.append(additionsBlock);
		}

		QSaveFile output(ignorePath);
		if (!output.open(QIODevice::WriteOnly)) {
			Q_EMIT error(QStringLiteral("Could not write %1: %2").arg(ignorePath, output.errorString()));
			continue;
		}

		if (output.write(contents) != contents.size()) {
			Q_EMIT error(QStringLiteral("Could not fully write %1: %2").arg(ignorePath, output.errorString()));
			output.cancelWriting();
			continue;
		}

		if (!output.commit())
			Q_EMIT error(QStringLiteral("Could not replace %1: %2").arg(ignorePath, output.errorString()));
	}
}

K_PLUGIN_CLASS_WITH_JSON(SeafileIgnoreAction, "seafileignoreaction.json")

#include "seafileignoreaction.moc"
